"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CREDENTIAL_PROVIDERS,
  decryptSecret,
  encryptSecret,
  hasMasterKey,
  parseMasterKey,
  redact,
  resolveSourceCredentials,
  type CredentialProvider,
} from "@/src/domain/sources/credentials";
import { IgnavFlightSource } from "@/src/domain/sources/ignav-source";

export type CredentialState = { error?: string; ok?: boolean };

// Administrator allowlist. Source credentials are global configuration, not
// per-user data, so only the configured admin may read or write them. The
// check happens here, on the server: hiding the button is not authorisation.
async function requireAdmin(): Promise<string | null> {
  const allowed = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!allowed) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email?.toLowerCase() !== allowed) return null;
  return user.email ?? null;
}

function deny(): CredentialState {
  return { error: "Solo el administrador puede gestionar las fuentes de vuelos." };
}

// A stored credential must never reach the client, not even partially: the
// action only ever answers status, never contents.
function statusesOnly() {
  return { error: undefined, ok: true };
}

export async function saveSourceCredential(
  _prev: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const admin = await requireAdmin();
  if (!admin) return deny();

  const provider = String(formData.get("provider") ?? "");
  if (!CREDENTIAL_PROVIDERS.includes(provider as CredentialProvider)) {
    return { error: "Fuente desconocida." };
  }
  const secret = String(formData.get("secret") ?? "").trim();
  if (!secret) return { error: "Introduce una credencial." };

  if (!hasMasterKey()) {
    return {
      error:
        "El servidor no tiene SOURCE_SECRET_KEY configurada: no se puede guardar cifrada. Contacta con el administrador del despliegue.",
    };
  }

  const db = createAdminClient();
  const { error } = await db.from("source_credentials").upsert(
    {
      provider,
      secret_encrypted: await encryptSecret(secret, parseMasterKey(process.env.SOURCE_SECRET_KEY)),
      updated_at: new Date().toISOString(),
      updated_by: admin,
    },
    { onConflict: "provider" },
  );

  if (error) {
    console.error(
      `[credentials] guardado fallido (${provider}): ${redact(error.message, [secret])}`,
    );
    return { error: "No se pudo guardar la credencial. Revisa los registros del servidor." };
  }

  revalidatePath("/settings");
  return statusesOnly();
}

// Reversal: drop the stored credential. The environment variable, if present,
// keeps working, so removing a key is a two-step, observable operation.
export async function clearSourceCredential(
  _prev: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const admin = await requireAdmin();
  if (!admin) return deny();

  const provider = String(formData.get("provider") ?? "");
  if (!CREDENTIAL_PROVIDERS.includes(provider as CredentialProvider)) {
    return { error: "Fuente desconocida." };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("source_credentials")
    .delete()
    .eq("provider", provider);

  if (error) return { error: "No se pudo quitar la credencial guardada." };

  revalidatePath("/settings");
  return statusesOnly();
}

/**
 * Connection check. Only providers with a free health endpoint are testable;
 * for the rest this returns why not instead of spending quota to "prove"
 * something. Error messages are sanitised: provider payloads can echo the key.
 */
export async function testSourceConnection(
  _prev: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const admin = await requireAdmin();
  if (!admin) return deny();

  const provider = String(formData.get("provider") ?? "");
  if (!CREDENTIAL_PROVIDERS.includes(provider as CredentialProvider)) {
    return { error: "Fuente desconocida." };
  }

  // The credential path only needs a narrow slice of the client (see
  // CredentialClient); casting keeps Supabase's huge inferred type out of it.
  const credentials = await resolveSourceCredentials(createAdminClient() as never);
  const secret = provider === "serpapi" ? credentials.serpapi : credentials.ignav;
  if (!secret) {
    return { error: "No hay credencial configurada para esta fuente." };
  }

  if (provider === "ignav") {
    try {
      const result = await new IgnavFlightSource(secret).verifyCredential();
      if (result.ok) return statusesOnly();
      if (result.reason === "invalid_key") {
        return { error: "Ignav rechazó esta credencial: no es válida." };
      }
      if (result.reason === "billing") {
        return {
          error:
            "La credencial es válida pero la cuenta de Ignav requiere facturación o ha agotado su cupo.",
        };
      }
      return { error: "No se pudo contactar con Ignav. Inténtalo de nuevo." };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[credentials] verify ignav: ${redact(message, [secret])}`);
      return {
        error: "No se pudo comprobar la credencial. Revisa los registros del servidor.",
      };
    }
  }

  return {
    error:
      "SerpAPI no permite comprobar la clave sin gastar cuota: cualquier llamada consume una búsqueda.",
  };
}

/** Used by the settings page to build the cards. Never returns secrets. */
export async function getCredentialStatuses(): Promise<
  { provider: CredentialProvider; origin: "env" | "database" | "none" }[] | null
> {
  const admin = await requireAdmin();
  // No redirect here: the settings page also holds the profile currency, so a
  // non-admin simply sees no credentials section (and mutations still guard).
  if (!admin) return null;

  // The credential path only needs a narrow slice of the client (see
  // CredentialClient); casting keeps Supabase's huge inferred type out of it.
  const credentials = await resolveSourceCredentials(createAdminClient() as never);
  return [
    { provider: "serpapi", origin: credentials.serpapiOrigin },
    { provider: "ignav", origin: credentials.ignavOrigin },
  ];
}

// Read-only helper for operators: decrypting a stored key must never be
// exposed to the UI, so this lives behind the admin guard and is only used by
// diagnostics (it does not print the secret either).
export async function describeStoredCredential(provider: CredentialProvider): Promise<
  "configurada" | "sin configurar" | "ilegible"
> {
  const admin = await requireAdmin();
  if (!admin) return "sin configurar";
  if (!hasMasterKey()) return "ilegible";

  const db = createAdminClient();
  const { data, error } = await db
    .from("source_credentials")
    .select("secret_encrypted")
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data) return "sin configurar";

  try {
    await decryptSecret(data.secret_encrypted, parseMasterKey(process.env.SOURCE_SECRET_KEY));
    return "configurada";
  } catch {
    return "ilegible";
  }
}
