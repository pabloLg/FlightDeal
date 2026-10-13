"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { runExecution, type SearchRow } from "@/src/domain/search/execute-search";

export type SearchFormState = { error?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return supabase;
}

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

function readForm(formData: FormData) {
  const thresholdRaw = formData.get("alert_threshold_eur");
  const alert_threshold_eur =
    thresholdRaw === null || String(thresholdRaw).trim() === ""
      ? null
      : Number(thresholdRaw);
  const flexRaw = formData.get("date_flex_days");
  const date_flex_days =
    flexRaw === null || String(flexRaw).trim() === "" ? 0 : Number(flexRaw);
  return {
    origin: String(formData.get("origin") ?? "").trim().toUpperCase(),
    destination: String(formData.get("destination") ?? "").trim().toUpperCase(),
    depart_date: (formData.get("depart_date") as string) || null,
    return_date: (formData.get("return_date") as string) || null,
    trip_type: (formData.get("trip_type") as string) || "round_trip",
    cabin_class: (formData.get("cabin_class") as string) || "economy",
    stops: (formData.get("stops") as string) || "any",
    adults: Number(formData.get("adults")) || 1,
    alert_threshold_eur,
    date_flex_days,
  };
}

export async function createSearch(
  _prevState: SearchFormState,
  formData: FormData,
): Promise<SearchFormState> {
  const { supabase, userId } = await requireUserId();

  const values = readForm(formData);
  if (!values.origin || !values.destination) {
    return { error: "Origen y destino son obligatorios" };
  }

  const { error } = await supabase.from("searches").insert({
    ...values,
    profile_id: userId,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return {};
}

export async function updateSearch(
  id: string,
  _prevState: SearchFormState,
  formData: FormData,
): Promise<SearchFormState> {
  const supabase = await requireUser();
  const { error } = await supabase
    .from("searches")
    .update(readForm(formData))
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return {};
}

export async function toggleSearch(id: string, enabled: boolean): Promise<void> {
  const supabase = await requireUser();
  await supabase.from("searches").update({ enabled }).eq("id", id);
  revalidatePath("/dashboard");
}

export async function deleteSearch(id: string): Promise<void> {
  const supabase = await requireUser();
  await supabase.from("searches").delete().eq("id", id);
  revalidatePath("/dashboard");
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function refreshDealForDate(
  searchId: string,
  departDate: string,
  returnDate?: string | null,
): Promise<{ success: boolean; error?: string; executionId?: string; reuse?: boolean }> {
  const { supabase, userId } = await requireUserId();

  if (!isYmd(departDate)) {
    return { success: false, error: "Fecha de salida inválida" };
  }
  if (returnDate && !isYmd(returnDate)) {
    return { success: false, error: "Fecha de vuelta inválida" };
  }

  const { data: search, error: searchError } = await supabase
    .from("searches")
    .select("*")
    .eq("id", searchId)
    .eq("profile_id", userId)
    .single();
  if (searchError || !search) {
    return { success: false, error: "Búsqueda no encontrada" };
  }

  if (search.trip_type === "round_trip" && returnDate) {
    if (returnDate <= departDate) {
      return { success: false, error: "La fecha de vuelta debe ser posterior a la de salida" };
    }
  }

  const { data: lastExec } = await supabase
    .from("search_executions")
    .select("id, status")
    .eq("search_id", searchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastExec && (lastExec.status === "pending" || lastExec.status === "running")) {
    return { success: true, executionId: lastExec.id, reuse: true };
  }

  const { data: execution, error: executionError } = await supabase
    .from("search_executions")
    .insert({ search_id: searchId, status: "pending" })
    .select()
    .single();
  if (executionError || !execution) {
    return { success: false, error: "No se pudo iniciar la ejecución" };
  }

  const clonedSearch: SearchRow = {
    id: search.id,
    profile_id: search.profile_id,
    origin: search.origin,
    destination: search.destination,
    depart_date: departDate,
    return_date: search.trip_type === "round_trip" ? (returnDate ?? search.return_date) : null,
    trip_type: search.trip_type,
    cabin_class: search.cabin_class,
    stops: search.stops,
    adults: search.adults,
    alert_threshold_eur: search.alert_threshold_eur,
    date_flex_days: search.date_flex_days,
  } as SearchRow;

  const { data: profile } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", userId)
    .single();
  const currency = profile?.currency ?? "EUR";

  // Keep the invocation alive until the execution is persisted, same contract
  // as the API route: a bare floating promise can be killed mid-scrape.
  after(() => runExecution(supabase, clonedSearch, execution.id, currency));

  return { success: true, executionId: execution.id, reuse: false };
}
