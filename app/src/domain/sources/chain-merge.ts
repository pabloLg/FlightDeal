import type { FlightSource } from "./flight-source";
import { SEARCH_BUDGET_MS } from "./flight-source";
import { getMaxSourcesPerRun, getSourceTimeoutMarginMs } from "./chain";
import type {
  FlightOption,
  FlightSearchParams,
  FlightSourceResult,
} from "./types";

export interface MergeAttempt {
  sourceId: string;
  degraded: boolean;
  ms: number;
  message?: string;
  included?: boolean;
  reason?: string;
}

// What the run asked, what it kept, and what won. Lives in raw_result next
// to attempts (no new tables); the UI badge reads the winner from the rows.
export interface AggregationSummary {
  sourcesAttempted: string[];
  sourcesIncluded: string[];
  optionCount: number;
  bestPrice: number | null;
  bestSource: string | null;
  maxSourcesPerRun: number;
}

export interface MergedChainOutcome {
  result: FlightSourceResult & { aggregation?: AggregationSummary };
  sourceId: string;
  attempts: MergeAttempt[];
  aggregation: AggregationSummary;
  // Source per option, aligned with result.options by index. Rows stay
  // per-source (tarjeta por fuente, stable dedupe keys) so this is how the
  // runner knows which source_id to persist on each flight_options row.
  optionSources: string[];
  // returnLegs traceability per source (the SerpAPI second request).
  returnLegsBySource: Record<string, string>;
}

// Sequential aggregation, tarjeta por fuente: every source is asked in
// FLIGHT_SOURCES order within one budget and every non-degraded option is
// kept with its own source. Nothing is fused by price: the same itinerary
// from two sources stays two rows (two cards), and the cheapest one earns
// the "best price" badge. A verified-empty result (options: [], degraded:
// false) stops the chain — asking another source for a price on a route
// with no fares would persist a bogus fare (F8 doctrine).
export async function searchWithSequentialMerge(
  sources: FlightSource[],
  params: FlightSearchParams,
  budgetMs: number = SEARCH_BUDGET_MS,
  env: Record<string, string | undefined> = process.env,
): Promise<MergedChainOutcome> {
  const maxSources = getMaxSourcesPerRun(env);
  const marginMs = getSourceTimeoutMarginMs(env);
  const attempts: MergeAttempt[] = [];
  const accumulated: FlightOption[] = [];
  const optionSources: string[] = [];
  const sourcesAttempted: string[] = [];
  const sourcesIncluded: string[] = [];
  const returnLegsBySource: Record<string, string> = {};
  const deadline = Date.now() + budgetMs;
  let bestPrice: number | null = null;
  let bestSource: string | null = null;
  let structureVersion = 0;
  let lastDegraded: { result: FlightSourceResult; sourceId: string } | null = null;
  let emptyResult: { result: FlightSourceResult; sourceId: string } | null = null;

  const summary = (): AggregationSummary => ({
    sourcesAttempted,
    sourcesIncluded,
    optionCount: accumulated.length,
    bestPrice,
    bestSource,
    maxSourcesPerRun: maxSources,
  });

  for (const source of sources) {
    const now = Date.now();
    if (sourcesAttempted.length >= maxSources) {
      attempts.push({
        sourceId: source.id,
        degraded: true,
        ms: 0,
        included: false,
        reason: "max_sources_per_run_reached",
      });
      continue;
    }
    if (now >= deadline) {
      attempts.push({
        sourceId: source.id,
        degraded: true,
        ms: 0,
        included: false,
        reason: "budget_exhausted:chain",
      });
      break;
    }
    const remaining = deadline - now;
    if (remaining < marginMs) {
      attempts.push({
        sourceId: source.id,
        degraded: true,
        ms: 0,
        included: false,
        reason: "timeout_margin_exceeded",
      });
      break;
    }

    sourcesAttempted.push(source.id);
    let result: FlightSourceResult;
    const startedAt = Date.now();
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
    const ms = Date.now() - startedAt;
    // Per-source cost log (F10 parity): Vercel function logs are the only
    // window into which sources a production run actually asked.
    console.log(
      `[chain-merge] ${source.id} ${result.degraded ? "degraded" : `ok:${result.options.length}`} in ${ms}ms${result.message ? ` (${result.message})` : ""}`,
    );
    if (result.degraded) {
      attempts.push({
        sourceId: source.id,
        degraded: true,
        ms,
        included: false,
        reason: result.message || "degraded",
        message: result.message,
      });
      lastDegraded = { result, sourceId: source.id };
      continue;
    }
    const returnLegs = (result as FlightSourceResult & { returnLegs?: string })
      .returnLegs;
    if (returnLegs) returnLegsBySource[source.id] = returnLegs;
    if (result.options.length === 0) {
      attempts.push({
        sourceId: source.id,
        degraded: false,
        ms,
        included: false,
        reason: "no_flights",
        message: result.message,
      });
      // Verified-empty stops the chain (F8): the route has no fares, so no
      // other source is asked. Rows already collected are real observations
      // and are kept.
      if (!emptyResult) emptyResult = { result, sourceId: source.id };
      break;
    }
    for (const option of result.options) {
      accumulated.push(option);
      optionSources.push(source.id);
      if (bestPrice === null || option.price < bestPrice) {
        bestPrice = option.price;
        bestSource = source.id;
      }
    }
    if (result.structureVersion > structureVersion) {
      structureVersion = result.structureVersion;
    }
    attempts.push({
      sourceId: source.id,
      degraded: false,
      ms,
      included: true,
      message: result.message,
    });
    if (!sourcesIncluded.includes(source.id)) {
      sourcesIncluded.push(source.id);
    }
  }

  const aggregation = summary();

  if (accumulated.length > 0) {
    return {
      result: {
        options: accumulated,
        currency: params.currency,
        structureVersion,
        degraded: false,
        aggregation,
      },
      sourceId: bestSource ?? sourcesIncluded[0] ?? sourcesAttempted[0] ?? "none",
      attempts,
      aggregation,
      optionSources,
      returnLegsBySource,
    };
  }

  if (emptyResult) {
    return {
      result: {
        ...emptyResult.result,
        aggregation,
      },
      sourceId: emptyResult.sourceId,
      attempts,
      aggregation,
      optionSources,
      returnLegsBySource,
    };
  }

  if (lastDegraded) {
    return {
      result: {
        ...lastDegraded.result,
        aggregation,
      },
      sourceId: lastDegraded.sourceId,
      attempts,
      aggregation,
      optionSources,
      returnLegsBySource,
    };
  }

  return {
    result: {
      options: [],
      currency: params.currency,
      structureVersion: 0,
      degraded: true,
      message: "no_sources_configured",
      aggregation,
    },
    sourceId: "none",
    attempts,
    aggregation,
    optionSources,
    returnLegsBySource,
  };
}
