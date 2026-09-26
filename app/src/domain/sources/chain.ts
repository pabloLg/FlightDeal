import type { FlightSource } from "./flight-source";
import { IgnavFlightSource } from "./ignav-source";
import { MockFlightSource } from "./mock-flight-source";
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
  attempts: { sourceId: string; degraded: boolean; message?: string }[];
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
): Promise<ChainOutcome> {
  const attempts: ChainOutcome["attempts"] = [];
  let last: { result: FlightSourceResult; sourceId: string } | null = null;

  for (const source of sources) {
    let result: FlightSourceResult;
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

    attempts.push({
      sourceId: source.id,
      degraded: result.degraded,
      ...(result.message ? { message: result.message } : {}),
    });
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
