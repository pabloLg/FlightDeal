"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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