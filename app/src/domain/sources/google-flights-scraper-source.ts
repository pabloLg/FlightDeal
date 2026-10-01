import { SEARCH_BUDGET_MS } from "./flight-source";
import type { FlightSource } from "./flight-source";
import { optionKey } from "./option-key";
import { parsePage, normalize } from "./parse-page";
import { parseReturnLegs } from "./rpc-return-legs";
import { buildTfsUrl } from "./tfs-url";
import { structureGuard, STRUCTURE_VERSION } from "./structure-guard";
import type {
  FlightLeg,
  FlightOption,
  FlightSearchParams,
  FlightSourceResult,
  HealthStatus,
} from "./types";

// Navigation strategy, injectable so unit tests run offline against fixtures.
// Production wiring supplies a Playwright-backed fetcher (google-flights-scraper
// skill: anonymous context, consent-only cookies, no login/NID).
// Every fetch is clamped to `deadline` (epoch ms) instead of the platform
// capping us mid-scrape: one search = two page loads (results + return legs),
// so the budget has to cover the whole attempt, not each load on its own.
export type HtmlFetcher = (url: string, deadline: number) => Promise<string>;

// Round trips only: body of the GetShoppingResults RPC that carries the return
// options once an outbound flight has been selected. Optional — without it the
// options keep empty inboundLegs (the price is still the full round-trip total).
export type ReturnLegsFetcher = (url: string, deadline: number) => Promise<string>;

export class GoogleFlightsScraperSource implements FlightSource {
  readonly id = "google_flights";
  private readonly fetcher: HtmlFetcher;
  private readonly returnLegsFetcher?: ReturnLegsFetcher;

  constructor(fetcher: HtmlFetcher, returnLegsFetcher?: ReturnLegsFetcher) {
    this.fetcher = fetcher;
    this.returnLegsFetcher = returnLegsFetcher;
  }

  async search(params: FlightSearchParams): Promise<FlightSourceResult> {
    const url = buildTfsUrl(params);
    const deadline = Date.now() + SEARCH_BUDGET_MS;
    let html: string;
    try {
      html = await this.fetcher(url, deadline);
    } catch (error) {
      // Fail-closed: navigation failures degrade instead of surfacing raw.
      const message = error instanceof Error ? error.message : String(error);
      return {
        options: [],
        currency: params.currency,
        structureVersion: STRUCTURE_VERSION,
        degraded: true,
        message: `fetch_failed:${message}`,
      };
    }

    const guard = structureGuard(html);
    if (!guard.ok) {
      return {
        options: [],
        currency: params.currency,
        structureVersion: guard.version,
        degraded: true,
        message: `structure_mismatch:${guard.reason ?? "unknown"}`,
      };
    }

    // A structurally valid page with no options is a legitimate "no flights"
    // outcome, not a failure: report it as a completed empty search.
    const raw = parsePage(html);
    const options = await this.attachReturnLegs(url, deadline, params, normalize(raw, params));
    return {
      options,
      currency: params.currency,
      structureVersion: STRUCTURE_VERSION,
      degraded: false,
      ...(options.length === 0 ? { message: "no_flights" } : {}),
    };
  }

  // Enrichment, never a gate: a round trip whose return list cannot be read
  // still reports its outbound options with the round-trip total price.
  // ponytail: only Google's first pick gets return legs — one extra page load
  // per search; loop over the window if per-option returns matter.
  private async attachReturnLegs(
    url: string,
    deadline: number,
    params: FlightSearchParams,
    options: FlightOption[],
  ): Promise<FlightOption[]> {
    if (
      !this.returnLegsFetcher ||
      params.tripType !== "round_trip" ||
      !params.returnDate ||
      (params.flexDays ?? 0) > 0
    ) {
      return options;
    }

    let body: string;
    try {
      body = await this.returnLegsFetcher(url, deadline);
    } catch {
      return options;
    }
    const payload = parseReturnLegs(body);
    if (!payload) return options;

    // Cheapest return: its price is the whole itinerary (Google quotes round
    // trip totals), so it prices the outbound too.
    const cheapestReturn = payload.options.reduce((min, option) =>
      option.price < min.price ? option : min,
    );
    const outboundLegs: FlightLeg[] = payload.selectedOutbound;
    const inboundLegs: FlightLeg[] = cheapestReturn.outboundLegs;
    const itinerary: FlightOption = {
      id: optionKey("gf", outboundLegs, inboundLegs),
      price: cheapestReturn.price,
      currency: params.currency,
      outboundLegs,
      inboundLegs,
      airlines: [...new Set([...outboundLegs, ...inboundLegs].map((leg) => leg.airline))],
      totalDurationMin:
        outboundLegs.reduce((sum, leg) => sum + leg.durationMin, 0) +
        inboundLegs.reduce((sum, leg) => sum + leg.durationMin, 0),
    };

    // The selected outbound is usually absent from the parsed page list (it
    // lives in the "best options" block the parser skips), so append it; when it
    // is present, replace it instead of forking its price history in two.
    const index = options.findIndex(
      (option) =>
        optionKey("gf", option.outboundLegs, []) ===
        optionKey("gf", outboundLegs, []),
    );
    return index < 0
      ? [...options, itinerary]
      : [...options.slice(0, index), itinerary, ...options.slice(index + 1)];
  }

  async health(): Promise<HealthStatus> {
    return { ok: true, structureVersion: STRUCTURE_VERSION };
  }
}