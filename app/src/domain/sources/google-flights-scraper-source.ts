import type { FlightSource } from "./flight-source";
import type {
  FlightSearchParams,
  FlightSourceResult,
  HealthStatus,
} from "./types";
import { buildTfsUrl } from "./tfs-url";
import { parsePage, normalize } from "./parse-page";
import { structureGuard, STRUCTURE_VERSION } from "./structure-guard";

// Navigation strategy, injectable so unit tests run offline against fixtures.
// Production wiring supplies a Playwright-backed fetcher (google-flights-scraper
// skill: anonymous context, consent-only cookies, no login/NID).
export type HtmlFetcher = (url: string) => Promise<string>;

export class GoogleFlightsScraperSource implements FlightSource {
  readonly id = "google_flights";
  private readonly fetcher: HtmlFetcher;

  constructor(fetcher: HtmlFetcher) {
    this.fetcher = fetcher;
  }

  async search(params: FlightSearchParams): Promise<FlightSourceResult> {
    const url = buildTfsUrl(params);
    let html: string;
    try {
      html = await this.fetcher(url);
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
    return {
      options: normalize(raw, params),
      currency: params.currency,
      structureVersion: STRUCTURE_VERSION,
      degraded: false,
      ...(raw.length === 0 ? { message: "no_flights" } : {}),
    };
  }

  async health(): Promise<HealthStatus> {
    return { ok: true, structureVersion: STRUCTURE_VERSION };
  }
}