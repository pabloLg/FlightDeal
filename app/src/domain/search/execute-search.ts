import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateAlert } from "@/src/domain/alerts/evaluate-alert";
import { resolveChain, searchWithFailover } from "@/src/domain/sources/chain";
import type { FlightSearchParams } from "@/src/domain/sources/types";

export type Db = SupabaseClient;

export type SearchRow = {
  id: string;
  profile_id: string;
  origin: string;
  destination: string;
  depart_date: string | null;
  return_date: string | null;
  trip_type: "round_trip" | "one_way";
  cabin_class: "economy" | "premium_economy" | "business" | "first";
  stops: "any" | "non_stop";
  adults: number;
  alert_threshold_eur: number | null;
  date_flex_days: number;
};

export function toSearchParams(
  search: SearchRow,
  currency: string,
): FlightSearchParams {
  return {
    origin: search.origin,
    destination: search.destination,
    departDate: search.depart_date ?? "2026-01-01",
    returnDate: search.return_date ?? undefined,
    tripType: search.trip_type,
    cabinClass: search.cabin_class,
    stops: search.stops,
    adults: search.adults,
    currency,
    flexDays: search.date_flex_days || undefined,
  };
}

export async function runExecution(
  supabase: Db,
  search: SearchRow,
  executionId: string,
  currency: string,
) {
  const mark = (patch: Record<string, unknown>) =>
    supabase
      .from("search_executions")
      .update({ lease_holder: null, lease_expires_at: null, ...patch })
      .eq("id", executionId);

  try {
    await mark({ status: "running", started_at: new Date().toISOString() });

    const { sources, skipped } = resolveChain();
    const outcome = await searchWithFailover(
      sources,
      toSearchParams(search, currency),
    );
    const result = outcome.result;

    // Fail-closed: every source degraded (or none was configured), so nothing
    // is persisted and no alert is evaluated against prices we do not have.
    if (result.degraded) {
      await mark({
        status: "degraded",
        finished_at: new Date().toISOString(),
        structure_check_passed: false,
        error_message: result.message ?? "source_degraded",
        raw_result: {
          sourceId: outcome.sourceId,
          attempts: outcome.attempts,
          skipped,
        },
      });
      return;
    }

    if (result.options.length === 0) {
      await mark({
        status: "completed",
        finished_at: new Date().toISOString(),
        structure_check_passed: true,
        raw_result: {
          sourceId: outcome.sourceId,
          message: result.message ?? "no_flights",
        },
      });
      return;
    }

    // persist deduped flight options (match search_id+dedupe_key constraint) + price snapshot
    const priceByKey = new Map(result.options.map((o) => [o.id, o.price]));

    await supabase
      .from("flight_options")
      .upsert(
        result.options.map((option) => ({
          search_id: search.id,
          execution_id: executionId,
          dedupe_key: option.id,
          outbound_legs: option.outboundLegs,
          inbound_legs: option.inboundLegs,
          price_eur: option.price,
          currency: option.currency,
          airlines: option.airlines,
          total_duration_min: option.totalDurationMin,
        })),
        { onConflict: "search_id,dedupe_key" },
      );

    const { data: optionRows } = await supabase
      .from("flight_options")
      .select("id, dedupe_key")
      .eq("search_id", search.id);

    const priceByKeyClone = new Map(priceByKey);
    await supabase.from("flight_prices").insert(
      (optionRows ?? []).map((o: { id: string; dedupe_key: string }) => ({
        flight_option_id: o.id,
        price_eur: priceByKeyClone.get(o.dedupe_key) ?? 0,
      })),
    );

    await mark({
      status: "completed",
      finished_at: new Date().toISOString(),
      structure_check_passed: true,
      raw_result: {
        sourceId: outcome.sourceId,
        optionCount: result.options.length,
      },
    });

    await evaluateAndDispatchAlerts(supabase, search);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mark({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: message,
    });
  }
}

export async function evaluateAndDispatchAlerts(
  supabase: Db,
  search: SearchRow & { alert_threshold_eur: number | null },
) {
  try {
    const { data: options } = await supabase
      .from("flight_options")
      .select("id, price_eur")
      .eq("search_id", search.id);
    if (!options || options.length === 0) return;

    const best = options.reduce((min, o) =>
      Number(o.price_eur) < Number(min.price_eur) ? o : min,
    );

    const threshold = search.alert_threshold_eur ?? null;
    const { data: bestEdge } = await supabase
      .from("alerts_edge")
      .select("id, last_fired_at, cooldown_hours")
      .eq("search_id", search.id)
      .eq("provider", "telegram")
      .eq("threshold_eur", threshold)
      .maybeSingle();

    const decision = evaluateAlert({
      thresholdEur: threshold,
      bestOption: { id: best.id, priceEur: Number(best.price_eur) },
      lastFiredAt: bestEdge?.last_fired_at ?? null,
      cooldownHours: bestEdge?.cooldown_hours ?? 24,
      now: new Date().toISOString(),
    });

    if (!decision.shouldFire) return;

    const { error: upsertError, data: edge } = await supabase
      .from("alerts_edge")
      .upsert(
        {
          search_id: search.id,
          provider: "telegram",
          threshold_eur: threshold,
          cooldown_hours: 24,
        },
        { onConflict: "search_id,provider,threshold_eur", ignoreDuplicates: false },
      )
      .select()
      .single();
    if (upsertError || !edge) return;

    await supabase.from("alert_dispatches").insert({
      alert_id: edge.id,
      flight_option_id: decision.optionId,
      price_eur: decision.priceEur,
      status: "dispatched",
    });
    await supabase
      .from("alerts_edge")
      .update({ last_fired_at: new Date().toISOString() })
      .eq("id", edge.id);
  } catch {
    // alert engine never fails the execution
  }
}