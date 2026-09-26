"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type ProfileState = { error?: string };

export async function updateProfileCurrency(
  _prevState: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión no válida" };

  const currency = String(formData.get("currency") ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { error: "La moneda debe ser un código IATA de 3 letras (ej: EUR)" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ currency })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return {};
}