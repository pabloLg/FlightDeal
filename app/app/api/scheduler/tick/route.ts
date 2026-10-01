import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/bearer-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSearchById } from "@/src/domain/search/execute-search";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel freezes the invocation as soon as it responds: work started but not
// awaited never runs. Everything is awaited, sequentially, inside a wall-clock
// budget; leased executions left over keep their 10 min lease and the next tick
// picks them up (F10).
const BUDGET_MS = 45_000;

// Vercel Cron: POST /api/scheduler/tick with Authorization: Bearer <CRON_SECRET>
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!isAuthorized(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // run_retention() (F4) has no other caller, so this daily tick is the only
  // thing that ever purges expired price detail. Runs even with nothing to
  // scrape, and before the loop so the 45 s budget stays for the scrapes.
  const { data: purged } = await supabase.rpc("run_retention");
  const pricesPurged = typeof purged === "number" ? purged : 0;

  const { data: executions, error } = await supabase.rpc("scheduler_tick", {
    p_batch_size: 10,
    p_lease_ttl: "10 minutes",
    p_min_interval: "30 minutes",
  } as Record<string, unknown>);

  if (error) {
    return NextResponse.json({ error: "tick_failed", detail: error.message }, { status: 500 });
  }
  if (!executions || executions.length === 0) {
    return NextResponse.json({ executions: 0, pricesPurged });
  }

  const startedAt = Date.now();
  let done = 0;
  let deferred = 0;
  // Fits the *next* search before starting it, not just the elapsed time: a
  // search that took 50 s must not be followed by another inside a 60 s
  // invocation. Slowest-so-far seeds the estimate and then measures itself, so
  // a route that degrades at its budget does not stall the queue.
  let slowestMs = 30_000;
  for (const exec of executions as { execution_id: string; search_id: string }[]) {
    if (Date.now() - startedAt + slowestMs > BUDGET_MS) {
      deferred++;
      continue;
    }
    const searchStartedAt = Date.now();
    await runSearchById(supabase, exec.search_id, exec.execution_id);
    slowestMs = Math.max(slowestMs, Date.now() - searchStartedAt);
    console.log(`[tick] search done in ${Date.now() - searchStartedAt}ms, elapsed ${Date.now() - startedAt}ms`);
    done++;
  }

  return NextResponse.json({
    executions: executions.length,
    completed: done,
    deferred,
    pricesPurged,
    ms: Date.now() - startedAt,
  });
}
