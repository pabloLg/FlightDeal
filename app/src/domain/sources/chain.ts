import type { FlightSource } from "./flight-source";
import { GoogleFlightsScraperSource } from "./google-flights-scraper-source";
import { SEARCH_BUDGET_MS } from "./flight-source";
import { IgnavFlightSource } from "./ignav-source";
import { MockFlightSource } from "./mock-flight-source";
import {
  playwrightHtmlFetcher,
  playwrightReturnLegsFetcher,
} from "./playwright-fetcher";
import { SerpApiFlightSource } from "./serpapi-source";
import type { FlightSearchParams, FlightSourceResult } from "./types";

export interface SourceEnv {
  FLIGHT_SOURCES?: string;
  SERPAPI_API_KEY?: string;
  IGNAV_API_KEY?: string;
}

export interface ChainOutcome {
  result: FlightSourceResult;
  sourceId: string;
  attempts: { sourceId: string; degraded: boolean; ms: number; message?: string }[];
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

// First non-degraded source wins. An empty option list with degraded=false is a
// legitimate "no flights" and stops the chain: falling through would report a
// bogus price from another source for a route that simply has no fares.
export async function searchWithFailover(
  sources: FlightSource[],
  params: FlightSearchParams,
  budgetMs: number = SEARCH_BUDGET_MS,
  env: Record<string, string | undefined> = process.env,
): Promise<ChainOutcome> {
  const attempts: ChainOutcome["attempts"] = [];
  let last: { result: FlightSourceResult; sourceId: string } | null = null;
  // One budget for the whole chain: a source that burns all of it (the browser
  // scraper is the usual one) leaves no time for a fallback, and asking anyway is
  // how the invocation gets killed at the platform cap with nothing recorded.
  const deadline = Date.now() + budgetMs;
  const marginMs = getSourceTimeoutMarginMs(env);
  const maxSources = getMaxSourcesPerRun(env);
  let attempted = 0;

  for (const source of sources) {
    if (attempted >= maxSources) {
      attempts.push({
        sourceId: source.id,
        degraded: true,
        ms: 0,
        message: "max_sources_per_run_reached",
      });
      continue;
    }
    if (Date.now() >= deadline) {
      attempts.push({
        sourceId: source.id,
        degraded: true,
        ms: 0,
        message: "budget_exhausted:chain",
      });
      last = {
        result: {
          options: [],
          currency: params.currency,
          structureVersion: 0,
          degraded: true,
          message: "budget_exhausted:chain",
        },
        sourceId: source.id,
      };
      continue;
    }

    let result: FlightSourceResult;
    const startedAt = Date.now();
    attempted++;
    try {
      result = await source.search(params);
    } catch (error) {
      // A buggy adapter must not abort the chain; treat it as a degradation.
      const message = error instanceof Error ? error.message : String(error);
      result = {
        options: [],
        currency: params.currency,
        structureVersion: 0,
        degraded: true,
        message: `threw:${message}`,
      };
    }

    const attempt = {
      sourceId: source.id,
      degraded: result.degraded,
      // Per-source cost in ms: what the scraper actually spends per route, and
      // where the failover budget goes (F10).
      ms: Date.now() - startedAt,
      ...(result.message ? { message: result.message } : {}),
    };
    console.log(
      `[chain] ${attempt.sourceId} ${attempt.degraded ? "degraded" : "ok"} in ${attempt.ms}ms${attempt.message ? ` (${attempt.message})` : ""}`,
    );
    attempts.push(attempt);
    if (!result.degraded) return { result, sourceId: source.id, attempts };
    last = { result, sourceId: source.id };
  }

  return {
    result: last?.result ?? {
      options: [],
      currency: params.currency,
      structureVersion: 0,
      degraded: true,
      message: "no_sources_configured",
    },
    sourceId: last?.sourceId ?? "none",
    attempts,
  };
}
