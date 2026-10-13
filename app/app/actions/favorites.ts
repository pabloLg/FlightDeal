"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type FavoriteResult = { favorited: boolean; error?: string };

// Toggles the favorite of one flight option. The option row is read with RLS
// (scoped to the owner through its search), so a user can only favorite their
// own results. The row is copied as a snapshot because flight_options is
// recreated on every execution; (profile_id, search_id, dedupe_key) is the
// stable identity.
export async function toggleFavorite(optionId: string): Promise<FavoriteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { favorited: false, error: "Sesión no válida" };

  const { data: option } = await supabase
    .from("flight_options")
    .select("id, search_id, dedupe_key, price_eur, currency, outbound_legs, inbound_legs")
    .eq("id", optionId)
    .maybeSingle();
  if (!option) return { favorited: false, error: "Opción no encontrada" };

  const { data: existing } = await supabase
    .from("favorite_deals")
    .select("id")
    .eq("search_id", option.search_id)
    .eq("dedupe_key", option.dedupe_key)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("favorite_deals")
      .delete()
      .eq("id", existing.id);
    if (error) return { favorited: true, error: error.message };
    revalidatePath("/dashboard");
    revalidatePath(`/searches/${option.search_id}`);
    return { favorited: false };
  }

  const { data: search } = await supabase
    .from("searches")
    .select("origin, destination, depart_date, return_date")
    .eq("id", option.search_id)
    .maybeSingle();
  if (!search) return { favorited: false, error: "Búsqueda no encontrada" };

  const { error } = await supabase.from("favorite_deals").insert({
    profile_id: user.id,
    search_id: option.search_id,
    flight_option_id: option.id,
    dedupe_key: option.dedupe_key,
    origin: search.origin,
    destination: search.destination,
    depart_date: search.depart_date,
    return_date: search.return_date,
    price_eur: option.price_eur,
    currency: option.currency,
    outbound_legs: option.outbound_legs,
    inbound_legs: option.inbound_legs,
  });
  if (error) return { favorited: false, error: error.message };

  revalidatePath("/dashboard");
  revalidatePath(`/searches/${option.search_id}`);
  return { favorited: true };
}
