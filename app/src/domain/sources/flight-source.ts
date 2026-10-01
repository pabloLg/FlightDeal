import type {
  FlightSearchParams,
  FlightSourceResult,
  HealthStatus,
} from "./types";

// Wall clock one search may take across the whole failover chain. Vercel caps
// these routes at 60 s (maxDuration) and the invocation is killed outright past
// that, which leaves the execution stuck in running with no result to audit, so
// the chain stops asking for new sources once this is spent. The clamps in
// playwright-fetcher cover the waits; the paid HTTP sources carry their own
// AbortSignal timeout for the same reason.
export const SEARCH_BUDGET_MS = Number(process.env.SCRAPE_BUDGET_MS ?? 30_000);

export interface FlightSource {
  id: string;
  search(params: FlightSearchParams): Promise<FlightSourceResult>;
  health(): Promise<HealthStatus>;
}