import type { FlightOption, FlightSearchParams, FlightSourceResult } from "./types";
import { itineraryDedupeKey } from "./option-key";

export interface SourceAttempt {
  sourceId: string;
  degraded: boolean;
  ms: number;
  message?: string;
  included?: boolean;
  reason?: string;
}

export interface AggregationContext {
  sourcesAttempted: string[];
  sourcesIncluded: string[];
  mergedCount: number;
  duplicatesRemoved: number;
  maxSourcesPerRun: number;
  selectedSource: string | null;
  perKey?: Record<
    string,
    {
      sources: string[];
      selectedSource: string;
      price: number;
      hasBookingUrl: boolean;
    }
  >;
}

export interface AggregatedSourceResult {
  result: FlightSourceResult & { aggregated?: AggregationContext };
  sourceId: string;
  attempts: SourceAttempt[];
  aggregation: AggregationContext;
}

export interface AggregationOptions {
  maxSourcesPerRun: number;
  budgetMs: number;
  marginMs: number;
  deadline: number;
  params: FlightSearchParams;
  onBudgetExhausted?: (msg: string) => void;
}

export type MergedFlightOption = FlightOption & {
  sources: string[];
  selectedSource: string;
};

export function mergeFlightOptions(
  accumulated: Map<string, MergedFlightOption>,
  incoming: FlightOption[],
  sourceId: string,
): { merged: number; duplicates: number } {
  let merged = 0;
  let duplicates = 0;
  for (const opt of incoming) {
    const key = itineraryDedupeKey(opt.outboundLegs, opt.inboundLegs);
    const existing = accumulated.get(key);
    if (!existing) {
      const bookingUrls = [
        ...(opt.bookingUrl ? [{ source: sourceId, url: opt.bookingUrl }] : []),
        ...(opt.bookingUrls ?? []),
      ];
      const dedupUrls = bookingUrls.filter(
        (u, i, arr) => arr.findIndex((x) => x.source === u.source && x.url === u.url) === i,
      );
      accumulated.set(key, {
        ...opt,
        sources: [sourceId],
        selectedSource: sourceId,
        bookingUrls: dedupUrls.length > 0 ? dedupUrls : undefined,
      });
      merged++;
      continue;
    }
    const wasNew = !existing.sources.includes(sourceId);
    if (opt.price < existing.price - 1e-9) {
      const bookingUrls = [
        ...(opt.bookingUrl ? [{ source: sourceId, url: opt.bookingUrl }] : []),
        ...(opt.bookingUrls ?? []),
        ...(existing.bookingUrls ?? []),
      ];
      const dedupUrls = bookingUrls.filter(
        (u, i, arr) => arr.findIndex((x) => x.source === u.source && x.url === u.url) === i,
      );
      accumulated.set(key, {
        ...existing,
        price: opt.price,
        currency: opt.currency,
        airlines: opt.airlines.length > 0 ? opt.airlines : existing.airlines,
        totalDurationMin: opt.totalDurationMin || existing.totalDurationMin,
        outboundLegs: opt.outboundLegs,
        inboundLegs: opt.inboundLegs,
        selectedSource: sourceId,
        sources: wasNew ? Array.from(new Set([...existing.sources, sourceId])) : existing.sources,
        bookingUrls: dedupUrls.length > 0 ? dedupUrls : existing.bookingUrls,
      });
      if (wasNew) duplicates++;
      continue;
    } else {
      const bookingUrls = [
        ...(opt.bookingUrl ? [{ source: sourceId, url: opt.bookingUrl }] : []),
        ...(opt.bookingUrls ?? []),
        ...(existing.bookingUrls ?? []),
      ];
      const dedupUrls = bookingUrls.filter(
        (u, i, arr) => arr.findIndex((x) => x.source === u.source && x.url === u.url) === i,
      );
      if (wasNew) {
        accumulated.set(key, {
          ...existing,
          sources: Array.from(new Set([...existing.sources, sourceId])),
          bookingUrls: dedupUrls.length > 0 ? dedupUrls : existing.bookingUrls,
        });
        duplicates++;
      }
      continue;
    }
  }
  return { merged, duplicates };
}

export function buildAggregationContext(
  accumulated: Map<string, MergedFlightOption>,
  sourcesAttempted: string[],
  sourcesIncluded: string[],
  maxSourcesPerRun: number,
): AggregationContext {
  let duplicatesRemoved = 0;
  const perKey: AggregationContext["perKey"] = {};
  for (const [key, opt] of accumulated.entries()) {
    perKey[key] = {
      sources: opt.sources,
      selectedSource: opt.selectedSource,
      price: opt.price,
      hasBookingUrl: Boolean(opt.bookingUrl || (opt.bookingUrls?.length ?? 0) > 0),
    };
    if (opt.sources.length > 1) duplicatesRemoved += opt.sources.length - 1;
  }
  return {
    sourcesAttempted,
    sourcesIncluded,
    mergedCount: accumulated.size,
    duplicatesRemoved,
    maxSourcesPerRun,
    selectedSource: sourcesIncluded[0] ?? (sourcesAttempted[0] ?? null),
    perKey,
  };
}
