import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { runExecution, type Db, type SearchRow } from "@/src/domain/search/execute-search";

export const runtime = "nodejs";

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

  // Loose coupling: run each execution without awaiting so the cron returns fast.
  for (const exec of executions as { execution_id: string; search_id: string }[]) {
    void runSearchExecution(supabase, exec.execution_id, exec.search_id);
  }

  return NextResponse.json({ executions: executions.length });
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