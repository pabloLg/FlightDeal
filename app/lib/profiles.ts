import type { SupabaseClient } from "@supabase/supabase-js";

type ProfileUser = { id: string; email?: string | null };

/**
 * Garantiza que el usuario tenga fila en `profiles`.
 *
 * La fila la crea el trigger `on_auth_user_created`, pero ese trigger ha
 * faltado en la BD hospedada alguna vez y el usuario se quedaba sin perfil:
 * crear una búsqueda reventaba con `searches_profile_id_fkey`, ejecutar una
 * búsqueda devolvía 500 `profile_not_found` y cambiar la moneda no hacía nada
 * en silencio. Idempotente: si la fila ya existe no la toca (ni la moneda).
 */
export async function ensureProfile(
  supabase: SupabaseClient,
  user: ProfileUser,
): Promise<void> {
  await supabase.from("profiles").upsert(
    { id: user.id, email: user.email ?? "" },
    { onConflict: "id", ignoreDuplicates: true },
  );
}
