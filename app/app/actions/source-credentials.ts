"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CREDENTIAL_PROVIDERS,
  decryptSecret,
  encryptSecret,
  hasMasterKey,
  isAdminEmail,
  parseMasterKey,
  readStoredCredentialProviders,
  readStoredUserCredentialProviders,
  redact,
  resolveSourceCredentialsForProfile,
  type CredentialProvider,
} from "@/src/domain/sources/credentials";
import { IgnavFlightSource } from "@/src/domain/sources/ignav-source";

export type CredentialState = { error?: string; ok?: boolean };

// Administrator allowlist for the GLOBAL key pool. Per-user keys need no
// allowlist: RLS scopes them to their own profile. The check happens here, on
// the server: hiding the button is not authorisation.
async function requireAdmin(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email)) return null;
  return user?.email ?? null;
}

async function requireUser(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;
  return { id: user.id, email: user.email ?? "" };
}

const requireUserOrNull = requireUser;

function deny(): CredentialState {
  return { error: "Solo el administrador puede gestionar las claves globales." };
}

// A stored credential must never reach the client, not even partially: the
// action only ever answers status, never contents.
function statusesOnly() {
  return { error: undefined, ok: true };
}

function readProvider(formData: FormData): CredentialProvider | null {
  const provider = String(formData.get("provider") ?? "");
  return CREDENTIAL_PROVIDERS.includes(provider as CredentialProvider)
    ? (provider as CredentialProvider)
    : null;
}

/**
 * The caller's own key. No allowlist: the row is theirs (RLS enforces it in
 * the database, not just here).
 */
export async function saveUserCredential(
  _prev: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const user = await requireUser();
  if (!user) redirect("/login");

  const provider = readProvider(formData);
  if (!provider) return { error: "Fuente desconocida." };
  const secret = String(formData.get("secret") ?? "").trim();
  if (!secret) return { error: "Introduce una credencial." };

  if (!hasMasterKey()) {
    return {
      error:
        "El servidor no tiene SOURCE_SECRET_KEY configurada: no se puede guardar cifrada. Contacta con el administrador del despliegue.",
    };
  }

  const { error } = await createAdminClient()
    .from("user_source_credentials")
    .upsert(
      {
        profile_id: user.id,
        provider,
        secret_encrypted: await encryptSecret(secret, parseMasterKey(process.env.SOURCE_SECRET_KEY)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,provider" },
    );

  if (error) {
    console.error(
      `[credentials] guardado de usuario fallido (${provider}): ${redact(error.message, [secret])}`,
    );
    return { error: "No se pudo guardar la credencial. Revisa los registros del servidor." };
  }

  revalidatePath("/settings");
  return statusesOnly();
}

/** Remove the caller's own key: that source stops being asked for them. */
export async function clearUserCredential(
  _prev: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const user = await requireUser();
  if (!user) redirect("/login");

  const provider = readProvider(formData);
  if (!provider) return { error: "Fuente desconocida." };

  const { error } = await createAdminClient()
    .from("user_source_credentials")
    .delete()
    .eq("profile_id", user.id)
    .eq("provider", provider);

  if (error) return { error: "No se pudo quitar la credencial guardada." };

  revalidatePath("/settings");
  return statusesOnly();
}

/**
 * Connection check for the caller's own key, using the credentials that would
 * actually run: their own key, or the global one when they are the admin.
 */
export async function testUserCredential(
  _prev: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const user = await requireUser();
  if (!user) redirect("/login");

  const provider = readProvider(formData);
  if (!provider) return { error: "Fuente desconocida." };

  const credentials = await resolveSourceCredentialsForProfile(
    createAdminClient() as never,
    user.id,
  );
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

  // The global pool only applies to the admin's own executions, so the check
  // resolves what the admin would actually run.
  const credentials = await resolveSourceCredentialsForProfile(
    createAdminClient() as never,
    (await requireUserOrNull())?.id ?? "",
  );
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

export type GlobalCredentialStatus = {
  provider: CredentialProvider;
  /** "global" when the admin pool holds a key, "none" otherwise. */
  origin: "global" | "none";
  hasStored: boolean;
};

/** Global (admin) key statuses. Never returns secrets. */
export async function getGlobalCredentialStatuses(): Promise<
  GlobalCredentialStatus[] | null
> {
  const admin = await requireAdmin();
  // No redirect here: the settings page also holds the profile currency, so a
  // non-admin simply sees no global section (and mutations still guard).
  if (!admin) return null;

  const db = createAdminClient();
  const stored = await readStoredCredentialProviders(db as never);

  return [
    {
      provider: "serpapi",
      origin: stored.includes("serpapi") ? "global" : "none",
      hasStored: stored.includes("serpapi"),
    },
    {
      provider: "ignav",
      origin: stored.includes("ignav") ? "global" : "none",
      hasStored: stored.includes("ignav"),
    },
  ];
}

export type UserCredentialStatus = {
  provider: CredentialProvider;
  /** Whether the caller's own key exists. */
  hasOwn: boolean;
  /**
   * What a search of theirs would actually use: their own key, the admin's
   * global one (only when they ARE the admin), or nothing.
   */
  effective: "user" | "global" | "none";
};

/**
 * The caller's own key statuses, plus what a search of theirs would use right
 * now. Every signed-in user gets this: it is their own data.
 */
export async function getUserCredentialStatuses(): Promise<UserCredentialStatus[]> {
  const user = await requireUser();
  if (!user) redirect("/login");

  const db = createAdminClient();
  const own = await readStoredUserCredentialProviders(db as never, user.id);
  const resolved = await resolveSourceCredentialsForProfile(db as never, user.id);

  return [
    {
      provider: "serpapi",
      hasOwn: own.includes("serpapi"),
      effective: resolved.serpapiOrigin,
    },
    {
      provider: "ignav",
      hasOwn: own.includes("ignav"),
      effective: resolved.ignavOrigin,
    },
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
