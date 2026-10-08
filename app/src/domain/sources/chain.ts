import type { FlightSource } from "./flight-source";
import { GoogleFlightsScraperSource } from "./google-flights-scraper-source";
import { IgnavFlightSource } from "./ignav-source";
import { MockFlightSource } from "./mock-flight-source";
import {
  playwrightHtmlFetcher,
  playwrightReturnLegsFetcher,
} from "./playwright-fetcher";
import { SerpApiFlightSource } from "./serpapi-source";

export interface SourceEnv {
  FLIGHT_SOURCES?: string;
  SERPAPI_API_KEY?: string;
  IGNAV_API_KEY?: string;
}

export const DEFAULT_MAX_SOURCES_PER_RUN = 3;
export const DEFAULT_SOURCE_TIMEOUT_MARGIN_MS = 3000;

export function getMaxSourcesPerRun(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FLIGHT_MAX_SOURCES_PER_RUN;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0 && n <= 10) return n;
  return DEFAULT_MAX_SOURCES_PER_RUN;
}

export function getSourceTimeoutMarginMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FLIGHT_SOURCE_TIMEOUT_MARGIN_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_SOURCE_TIMEOUT_MARGIN_MS;
}

export function resolveChain(
  env: SourceEnv = {
    FLIGHT_SOURCES: process.env.FLIGHT_SOURCES,
    SERPAPI_API_KEY: process.env.SERPAPI_API_KEY,
    IGNAV_API_KEY: process.env.IGNAV_API_KEY,
  },
): { sources: FlightSource[]; skipped: string[] } {
  const requested = (env.FLIGHT_SOURCES ?? "mock")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const sources: FlightSource[] = [];
  const skipped: string[] = [];

  for (const name of requested) {
    switch (name) {
      case "mock":
        sources.push(new MockFlightSource());
        break;
      case "google_flights":
        // No key needed; the browser binary is the prerequisite (launch
        // failure degrades the source, the chain moves on).
        sources.push(
          new GoogleFlightsScraperSource(
            playwrightHtmlFetcher,
            playwrightReturnLegsFetcher,
          ),
        );
        break;
      case "serpapi":
        if (env.SERPAPI_API_KEY) {
          sources.push(new SerpApiFlightSource(env.SERPAPI_API_KEY));
        } else {
          skipped.push("serpapi:missing_api_key");
        }
        break;
      case "ignav":
        if (env.IGNAV_API_KEY) {
          sources.push(new IgnavFlightSource(env.IGNAV_API_KEY));
        } else {
          skipped.push("ignav:missing_api_key");
        }
        break;
      default:
        skipped.push(`${name}:unknown_source`);
    }
  }

  // Never mix synthetic prices into a real chain: a mock fallback would persist
  // fabricated fares alongside real ones and quietly poison price history.
  const realSources = sources.filter((source) => source.id !== "mock");
  return { sources: realSources.length > 0 ? realSources : sources, skipped };
}
