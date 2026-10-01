import type {
  HtmlFetcher,
  ReturnLegsFetcher,
} from "./google-flights-scraper-source";
import { parseReturnLegs } from "./rpc-return-legs";
import type { Browser, Page, Response } from "playwright-core";

// Playwright navigation for the Google Flights scraper. Frozen constraints
// (google-flights-scraper skill):
//   - URL built server-side by buildTfsUrl; the UI is only touched to select
//     the outbound flight of a round trip and read the return list.
//   - fresh anonymous context per search, consent cookie only. No login, no
//     account, no NID, no storageState reuse.
//   - no anti-bot evasion: no proxy rotation, no stealth patches, no captcha
//     solving. A block degrades the source and the chain moves on.
//
// ponytail: one browser per process, one context per search (fresh anonymous
// cookies, ~1 s context setup). Reuse a single context when throughput matters.

const CONSENT_COOKIE = {
  name: "SOCS",
  value: "CAESHAgBEhIaAB",
  domain: ".google.com",
  path: "/",
};

const RESULTS_CARD = 'div[role="link"][aria-label*="euros"], div[role="link"][aria-label*="$"]';
const RESULTS_PAYLOAD = "AF_initDataCallback({key: 'ds:1'";
const SHOPPING_RESULTS = "GetShoppingResults";
const NAV_TIMEOUT = 45_000;

// One deadline per search, owned by GoogleFlightsScraperSource. Per-operation
// timeouts do not add up to the platform limit: Vercel caps this function at
// 60 s (maxDuration) and two 45 s waits already overrun that, so Vercel kills
// the invocation mid-scrape and leaves the execution stuck in running. Every
// wait is clamped to what is left of the deadline, and a spent budget throws
// instead of starting another wait.

// Pure so the clamp is testable: how long the next wait may take. 0 means the
// budget is gone and the caller must give up rather than start another wait.
export function stepTimeout(deadline: number, now: number, cap = NAV_TIMEOUT): number {
  return Math.max(0, Math.min(cap, deadline - now));
}

function budgetLeft(deadline: number, label: string): number {
  const ms = stepTimeout(deadline, Date.now());
  if (ms === 0) throw new Error(`budget_exhausted:${label}`);
  return ms;
}

let browser: Promise<Browser> | null = null;

// Where the Chromium binary comes from:
//   - CHROMIUM_PATH: an explicit binary (self-hosted, Vercel wireframe, ...).
//   - VERCEL: @sparticuz/chromium, because a full browser cannot be bundled
//     (the archive is 67 MB Brotli, unpacked to /tmp on cold start).
//   - anywhere else: playwright-core's own download.
// ponytail: sparticuz forces --single-process and only ships chrome-headless-shell;
// if that ever stops working the chain degrades and falls over to SerpAPI/Ignav.
export function browserPlan(env: {
  CHROMIUM_PATH?: string;
  VERCEL?: string;
}): "chromium_path" | "vercel" | "playwright" {
  if (env.CHROMIUM_PATH) return "chromium_path";
  return env.VERCEL ? "vercel" : "playwright";
}

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const plan = browserPlan({
    CHROMIUM_PATH: process.env.CHROMIUM_PATH,
    VERCEL: process.env.VERCEL,
  });
  if (plan === "chromium_path") {
    return chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  }
  if (plan === "vercel") {
    const wireframe = await import("@sparticuz/chromium");
    const binary = wireframe.default;
    return chromium.launch({
      headless: true,
      executablePath: await binary.executablePath(),
      args: binary.args,
    });
  }
  return chromium.launch({ headless: true });
}

// The cache has to be validated, not just non-null: a warm lambda can be frozen
// between invocations and come back with its Chromium process already gone,
// which left every fetch failing with "Target page, context or browser has been
// closed" while the stale handle still looked fine.
async function getBrowser(): Promise<Browser> {
  if (browser) {
    const cached = await browser.catch(() => null);
    if (cached?.isConnected()) return cached;
  }
  const startedAt = Date.now();
  browser = launch().then((launched) => {
    console.log(`[scrape] browser launched in ${Date.now() - startedAt}ms`);
    return launched;
  });
  return browser;
}

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await (await getBrowser()).newContext({ locale: "es-ES" });
  await context.addCookies([CONSENT_COOKIE]);
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

// Consent wall: only ever "accept", never a personal choice, and never a login.
async function acceptConsentIfShown(page: Page, deadline: number): Promise<void> {
  const form = page.locator('form[action*="consent"]');
  if ((await form.count()) === 0) return;
  const accept = page
    .locator('form[action*="consent"] button, button:has-text("Aceptar todo"), button:has-text("Accept all")')
    .first();
  if ((await accept.count()) > 0) await accept.click();
  await page.waitForLoadState("domcontentloaded", {
    timeout: budgetLeft(deadline, "consent"),
  });
}

async function openResults(page: Page, url: string, deadline: number): Promise<void> {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: budgetLeft(deadline, "goto"),
  });
  await acceptConsentIfShown(page, deadline);
}

export const playwrightHtmlFetcher: HtmlFetcher = (url, deadline) =>
  withPage(async (page) => {
    const startedAt = Date.now();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await openResults(page, url, deadline);
        // The results shell is server-rendered; waiting for a card is only a
        // sanity check that we are not reading an interstitial.
        await page
          .locator(RESULTS_CARD)
          .first()
          .waitFor({ state: "attached", timeout: budgetLeft(deadline, "results_card") });
        const html = await page.content();
        // Google sometimes serves the shell before the server-rendered payload
        // (cards arrive from an RPC and ds:1 never lands in the HTML). Reloading
        // hits the payload-bearing variant; if both come up empty the source
        // degrades, which is the fail-closed behaviour we want.
        if (html.includes(RESULTS_PAYLOAD)) {
          console.log(
            `[scrape] results ok in ${Date.now() - startedAt}ms, ${html.length} bytes, attempt ${attempt + 1}`,
          );
          return html;
        }
        console.log(`[scrape] results payload missing, attempt ${attempt + 1}`);
      }
      throw new Error("results_payload_missing");
    } catch (error) {
      console.log(`[scrape] results failed in ${Date.now() - startedAt}ms: ${String(error)}`);
      throw error;
    }
  });

export const playwrightReturnLegsFetcher: ReturnLegsFetcher = (url, deadline) =>
  withPage(async (page) => {
    const startedAt = Date.now();
    try {
      return await readReturnLegs(page, url, deadline);
    } catch (error) {
      console.log(`[scrape] return legs failed in ${Date.now() - startedAt}ms: ${String(error)}`);
      throw error;
    }
  });

async function readReturnLegs(page: Page, url: string, deadline: number): Promise<string> {
  await openResults(page, url, deadline);
  const card = page.locator(RESULTS_CARD).first();
  await card.waitFor({ state: "attached", timeout: budgetLeft(deadline, "results_card") });

  // The return list is rendered from the GetShoppingResults RPC. The outbound
  // page fires one too, and it can land after the click, so the first response
  // is not enough: take the first post-click body that actually parses as a
  // return list. Timing out here degrades the source (fail-closed).
  const beforeClick = new WeakSet<import("playwright-core").Request>();
  let clicked = false;
  page.on("request", (request) => {
    if (!clicked) beforeClick.add(request);
  });
  const isReturnList = (response: Response) =>
    response.url().includes(SHOPPING_RESULTS) &&
    response.status() === 200 &&
    !beforeClick.has(response.request());

  // The card is a role=link overlay that intercepts pointer events, so the
  // click has to be dispatched on the element itself. Its handler is not
  // always bound yet when the shell renders, and a click that goes nowhere
  // fires no RPC: re-click instead of giving up, it is idempotent.
  for (;;) {
    clicked = true;
    await card.evaluate((element: Element) => (element as HTMLElement).click());
    try {
      const response = await page.waitForResponse(isReturnList, {
        timeout: Math.min(15_000, budgetLeft(deadline, "return_list")),
      });
      const body = await response.text();
      if (parseReturnLegs(body)) return body;
    } catch {
      // No matching response within the slice: re-click below.
    }
    if (Date.now() >= deadline) throw new Error("return_list_unavailable");
  }
}
