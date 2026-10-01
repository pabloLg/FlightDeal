import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/bearer-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSearchById } from "@/src/domain/search/execute-search";
import { canRetry } from "@/src/domain/search/retry-guard";

export const runtime = "nodejs";
// Same shape as the cron tick: the scrape is awaited inside the invocation
// budget (a bare promise would be frozen once the response goes out).
export const maxDuration = 60;

// D6: audited manual retry of a search the sources could not answer. Service
// role, Bearer CRON_SECRET; every attempt is another search_executions row, so
// the audit trail is the executions table itself.
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!isAuthorized(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let searchId: unknown;
  try {
    ({ searchId } = await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof searchId !== "string" || !searchId) {
    return NextResponse.json({ error: "searchId_required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  // Reap first: without this a runner killed mid-scrape (Vercel 60 s cap) leaves
  // a lease-less 'running' row that canRetry can never get past.
  await supabase.rpc("release_expired_leases");
  const { data: search } = await supabase
    .from("searches")
    .select("id")
    .eq("id", searchId)
    .maybeSingle();
  if (!search) return NextResponse.json({ error: "search_not_found" }, { status: 404 });

  const { data: latest } = await supabase
    .from("search_executions")
    .select("id, status, created_at, raw_result")
    .eq("search_id", searchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const verdict = canRetry(
    {
      status: latest?.status ?? "pending",
      createdAt: latest?.created_at ?? null,
      isRetry: (latest?.raw_result as { actor?: string } | null)?.actor === "admin",
    },
    Date.now(),
  );
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 429 });
  }

  // ponytail: guard-then-insert, so a tick landing in the same millisecond can
  // still double-run one search. Unique partial index on the search would
  // close it if manual retries ever stop being a one-operator affair.
  const { data: execution, error: insertError } = await supabase
    .from("search_executions")
    .insert({ search_id: searchId, status: "pending" })
    .select("id")
    .single();
  if (insertError || !execution) {
    return NextResponse.json({ error: "execution_start_failed" }, { status: 500 });
  }

  const startedAt = Date.now();
  const found = await runSearchById(supabase, searchId, execution.id, {
    actor: "admin",
    retriedFrom: latest?.id ?? null,
  });

  const { data: finished } = await supabase
    .from("search_executions")
    .select("status, error_message")
    .eq("id", execution.id)
    .single();

  return NextResponse.json({
    executionId: execution.id,
    retriedFrom: latest?.id ?? null,
    found,
    status: finished?.status ?? "unknown",
    error: finished?.error_message ?? null,
    ms: Date.now() - startedAt,
  });
}
