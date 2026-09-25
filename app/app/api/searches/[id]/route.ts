import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { evaluateAlert } from "@/src/domain/alerts/evaluate-alert";
import { MockFlightSource } from "@/src/domain/sources/mock-flight-source";
import type { FlightSearchParams } from "@/src/domain/sources/types";

export const runtime = "nodejs";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type SearchRow = {
  id: string;
  origin: string;
  destination: string;
  depart_date: string | null;
  return_date: string | null;
  trip_type: "round_trip" | "one_way";
  cabin_class: "economy" | "premium_economy" | "business" | "first";
  stops: "any" | "non_stop";
  adults: number;
  alert_threshold_eur: number | null;
};

function toSearchParams(
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
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: search, error: searchError } = await supabase
    .from("searches")
    .select("*")
    .eq("id", id)
    .single();
  if (searchError || !search) {
    return NextResponse.json({ error: "search_not_found" }, { status: 404 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 500 });
  }

  const { data: execution, error: executionError } = await supabase
    .from("search_executions")
    .insert({ search_id: id, status: "pending" })
    .select()
    .single();
  if (executionError || !execution) {
    return NextResponse.json({ error: "execution_start_failed" }, { status: 500 });
  }

  // Loose coupling: not awaited so the client can poll status transitions.
  void runExecution(supabase, search, execution.id, profile.currency);

  return NextResponse.json({ executionId: execution.id }, { status: 202 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("search_executions")
    .select("id, search_id, status, started_at, finished_at, error_message, structure_check_passed, created_at")
    .eq("search_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return NextResponse.json({ error: "no_execution" }, { status: 404 });

  return NextResponse.json({ execution: data });
}

async function runExecution(
  supabase: Supabase,
  search: SearchRow,
  executionId: string,
  currency: string,
) {
  const mark = (patch: Record<string, unknown>) =>
    supabase
      .from("search_executions")
      .update(patch)
      .eq("id", executionId);

  try {
    await mark({ status: "running", started_at: new Date().toISOString() });
    const source = new MockFlightSource();
    const result = await source.search(toSearchParams(search, currency));

    if (result.options.length === 0) {
      await mark({
        status: "completed",
        finished_at: new Date().toISOString(),
        structure_check_passed: true,
        raw_result: { message: result.message ?? "no_flights" },
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
      raw_result: { optionCount: result.options.length },
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

async function evaluateAndDispatchAlerts(
  supabase: Supabase,
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