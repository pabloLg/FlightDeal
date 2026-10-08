import type { FlightSource } from "./flight-source";
import { SEARCH_BUDGET_MS } from "./flight-source";
import { buildAggregationContext, mergeFlightOptions } from "./aggregator";
import { getMaxSourcesPerRun, getSourceTimeoutMarginMs } from "./chain";
import type { FlightSearchParams, FlightOption, FlightSourceResult } from "./types";

export interface MergeAttempt {
  sourceId: string;
  degraded: boolean;
  ms: number;
  message?: string;
  included?: boolean;
  reason?: string;
}

export interface MergedChainOutcome {
  result: FlightSourceResult & {
    aggregated?: ReturnType<typeof buildAggregationContext>;
  };
  sourceId: string;
  attempts: MergeAttempt[];
  aggregation: ReturnType<typeof buildAggregationContext>;
}

export async function searchWithSequentialMerge(
  sources: FlightSource[],
  params: FlightSearchParams,
  budgetMs: number = SEARCH_BUDGET_MS,
  env: Record<string, string | undefined> = process.env,
): Promise<MergedChainOutcome> {
  const maxSources = getMaxSourcesPerRun(env);
  const marginMs = getSourceTimeoutMarginMs(env);
  const attempts: MergeAttempt[] = [];
  const accumulated = new Map<
    string,
    import("./types").FlightOption & { sources: string[]; selectedSource: string }
  >();
  const sourcesAttempted: string[] = [];
  const sourcesIncluded: string[] = [];
  const deadline = Date.now() + budgetMs;
  let lastDegraded: { result: FlightSourceResult; sourceId: string } | null = null;

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
    if (result.options.length === 0 && result.message === "no_flights") {
      attempts.push({
        sourceId: source.id,
        degraded: false,
        ms,
        included: false,
        reason: "no_flights",
        message: result.message,
      });
      lastDegraded = { result, sourceId: source.id };
      continue;
    }
    const mergeRes = mergeFlightOptions(accumulated, result.options, source.id);
    const included = mergeRes.merged > 0 || accumulated.size > 0;
    attempts.push({
      sourceId: source.id,
      degraded: false,
      ms,
      included: true,
      message: result.message,
    });
    if (included && !sourcesIncluded.includes(source.id)) {
      sourcesIncluded.push(source.id);
    }
  }

  const aggregation = buildAggregationContext(
    accumulated,
    sourcesAttempted,
    sourcesIncluded,
    maxSources,
  );

  if (accumulated.size > 0) {
    // Strip the aggregation-only fields before returning domain options.
    const mergedOptions: FlightOption[] = Array.from(accumulated.values()).map((o) => ({
      id: o.id,
      price: o.price,
      currency: o.currency,
      outboundLegs: o.outboundLegs,
      inboundLegs: o.inboundLegs,
      airlines: o.airlines,
      totalDurationMin: o.totalDurationMin,
      ...(o.bookingUrl ? { bookingUrl: o.bookingUrl } : {}),
      ...(o.bookingUrls ? { bookingUrls: o.bookingUrls } : {}),
    }));
    return {
      result: {
        options: mergedOptions,
        currency: params.currency,
        structureVersion: 1,
        degraded: false,
        aggregated: aggregation,
      },
      sourceId: aggregation.selectedSource || sourcesIncluded[0] || sourcesAttempted[0] || "none",
      attempts,
      aggregation,
    };
  }

  if (lastDegraded) {
    return {
      result: {
        ...lastDegraded.result,
        aggregated: aggregation,
      },
      sourceId: lastDegraded.sourceId,
      attempts,
      aggregation,
    };
  }

  return {
    result: {
      options: [],
      currency: params.currency,
      structureVersion: 0,
      degraded: true,
      message: "no_sources_configured",
      aggregated: aggregation,
    },
    sourceId: "none",
    attempts,
    aggregation,
  };
}
