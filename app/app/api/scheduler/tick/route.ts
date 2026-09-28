import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { runExecution, type Db, type SearchRow } from "@/src/domain/search/execute-search";

export const runtime = "nodejs";

// Vercel freezes the invocation as soon as it responds: work started but not
// awaited never runs. Everything is awaited, sequentially, inside a wall-clock
// budget; leased executions left over keep their 10 min lease and the next tick
// picks them up (F10).
const BUDGET_MS = 45_000;

// Vercel Cron: POST /api/scheduler/tick with Authorization: Bearer <CRON_SECRET>
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: executions, error } = await supabase.rpc("scheduler_tick", {
    p_batch_size: 10,
    p_lease_ttl: "10 minutes",
    p_min_interval: "30 minutes",
  } as Record<string, unknown>);

  if (error) {
    return NextResponse.json({ error: "tick_failed", detail: error.message }, { status: 500 });
  }
  if (!executions || executions.length === 0) {
    return NextResponse.json({ executions: 0 });
  }

  const startedAt = Date.now();
  let done = 0;
  let deferred = 0;
  for (const exec of executions as { execution_id: string; search_id: string }[]) {
    if (Date.now() - startedAt > BUDGET_MS) {
      deferred++;
      continue;
    }
    await runSearchExecution(supabase, exec.execution_id, exec.search_id);
    done++;
  }

  return NextResponse.json({
    executions: executions.length,
    completed: done,
    deferred,
    ms: Date.now() - startedAt,
  });
}

async function runSearchExecution(supabase: Db, executionId: string, searchId: string) {
  const { data: search } = await supabase
    .from("searches")
    .select("*")
    .eq("id", searchId)
    .single();
  if (!search) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", (search as SearchRow).profile_id)
    .single();
  if (!profile) return;

  await runExecution(supabase, search as SearchRow, executionId, profile.currency);
}