import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { runExecution, type SearchRow } from "@/src/domain/search/execute-search";

export const runtime = "nodejs";

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
  void runExecution(supabase, search as SearchRow, execution.id, profile.currency);

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