// Flight-source credentials: stored encrypted, resolved with environment
// variables taking precedence.
//
// Why this exists: the app used to read SerpAPI/Ignav keys only from the
// deployment's environment variables, so rotating one meant editing Vercel.
// Here they can also live in the database, encrypted, and the UI shows where
// each one comes from. Environment still wins, so nothing changes in
// production until a variable is removed.
//
// Master key lives only in SOURCE_SECRET_KEY (server env). Without it the app
// can still read from env variables; it just cannot decrypt stored ones.

const ALGORITHM = "AES-GCM";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type CredentialProvider = "serpapi" | "ignav";

export const CREDENTIAL_PROVIDERS: CredentialProvider[] = ["serpapi", "ignav"];

export interface ProviderInfo {
  id: CredentialProvider;
  /** Display name in the settings page. */
  label: string;
  /** One-line explanation of what the credential is for. */
  description: string;
  /** Official place to obtain the credential. */
  docsUrl: string;
  /** Environment variable still honoured for this provider. */
  envVar: string;
  /** Whether a free connection check exists for it. */
  canTestConnection: boolean;
  /** Reason shown when there is no free check. */
  testNote?: string;
}

// Only these two sources take a key. google_flights runs on a browser and
// mock is for dev, so the settings page must not ask for credentials there.
export const PROVIDER_INFO: ProviderInfo[] = [
  {
    id: "serpapi",
    label: "SerpAPI",
    description:
      "Motor google_flights de SerpAPI. Cada búsqueda consume cuota (250/mes en el plan gratuito).",
    docsUrl: "https://serpapi.com/dashboard",
    envVar: "SERPAPI_API_KEY",
    canTestConnection: false,
    testNote:
      "Verificar consume cuota: cualquier llamada gasta una búsqueda. Si guardas la clave y una ejecución devuelve resultados, está correcta.",
  },
  {
    id: "ignav",
    label: "Ignav",
    description:
      "API de tarifas de Ignav. Devuelve ida y vuelta en la misma respuesta y tiene enlaces de reserva.",
    docsUrl: "https://ignav.com/dashboard",
    envVar: "IGNAV_API_KEY",
    canTestConnection: true,
  },
];

class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

// 32 bytes from hex (64 chars) or base64/base64url. Anything else is a
// configuration error, not a silent fallback: a short key would weaken the
// cipher without telling anyone.
export function parseMasterKey(raw: string | undefined): Uint8Array<ArrayBuffer> {
  const value = (raw ?? "").trim();
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return new Uint8Array(Buffer.from(value, "hex"));
  }
  try {
    const bytes = fromBase64Url(value);
    if (bytes.byteLength === KEY_BYTES) return new Uint8Array(bytes);
  } catch {
    // fall through to the error below
  }
  throw new CredentialError(
    "SOURCE_SECRET_KEY debe tener 32 bytes (64 caracteres hexadecimales o base64)",
  );
}

export function hasMasterKey(env: Record<string, string | undefined> = process.env): boolean {
  try {
    parseMasterKey(env.SOURCE_SECRET_KEY);
    return true;
  } catch {
    return false;
  }
}

// v1.<iv>.<ciphertext>, all base64url. Authenticated encryption: a modified
// payload fails to decrypt instead of returning garbage.
export async function encryptSecret(
  plain: string,
  masterKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await crypto.subtle.importKey(
    "raw",
    masterKey,
    { name: ALGORITHM },
    false,
    ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptSecret(
  payload: string,
  masterKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new CredentialError("formato de secreto no reconocido");
  }
  const [, ivPart, cipherPart] = parts;
  const key = await crypto.subtle.importKey(
    "raw",
    masterKey,
    { name: ALGORITHM },
    false,
    ["decrypt"],
  );
  try {
    const plain = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: fromBase64Url(ivPart) },
      key,
      fromBase64Url(cipherPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    // Wrong key or tampered payload: never leak which one.
    throw new CredentialError(
      "no se pudo descifrar la credencial almacenada (clave maestra distinta o dato alterado)",
    );
  }
}

/** Replaces every occurrence of a secret with *** so logs stay safe. */
export function redact(message: string, secrets: (string | null)[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 8 && out.includes(secret)) {
      out = out.split(secret).join("***");
    }
  }
  return out;
}

type StoredRow = { provider?: unknown; secret_encrypted?: unknown };

// Minimal structural shape the Supabase client satisfies. Kept narrow on
// purpose: the module must be testable with a stub and must not depend on the
// generated database types, which would make the credential path fragile.
type CredentialChain = {
  in: (
    column: string,
    values: readonly string[],
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  eq: (column: string, value: string) => {
    maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
  };
};

type CredentialQuery = { select: (columns: string) => CredentialChain };

export type CredentialClient = {
  from: (table: string) => CredentialQuery;
};

/** Where a credential in force came from. */
export type CredentialOrigin = "user" | "global" | "none";

export interface ResolvedCredentials {
  serpapi: string | null;
  ignav: string | null;
  serpapiOrigin: CredentialOrigin;
  ignavOrigin: CredentialOrigin;
}

const NONE: ResolvedCredentials = {
  serpapi: null,
  ignav: null,
  serpapiOrigin: "none",
  ignavOrigin: "none",
};

function isProvider(value: unknown): value is CredentialProvider {
  return value === "serpapi" || value === "ignav";
}

async function readRows(
  client: CredentialClient,
  table: string,
  filter: (chain: CredentialChain) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<StoredRow[]> {
  const { data, error } = await filter(client.from(table).select("provider, secret_encrypted"));
  if (error || !Array.isArray(data)) return [];
  return data.filter(
    (row): row is StoredRow =>
      typeof row === "object" && row !== null && typeof (row as StoredRow).secret_encrypted === "string",
  );
}

async function decryptRows(
  rows: StoredRow[],
  masterKey: Uint8Array<ArrayBuffer>,
): Promise<{ serpapi: string | null; ignav: string | null }> {
  const out: { serpapi: string | null; ignav: string | null } = {
    serpapi: null,
    ignav: null,
  };
  for (const row of rows) {
    if (!isProvider(row.provider)) continue;
    try {
      const secret = await decryptSecret(row.secret_encrypted as string, masterKey);
      out[row.provider] = secret;
    } catch {
      // Unreadable row: skip it. Another source can still work.
    }
  }
  return out;
}

/** True when the profile is the declared administrator (ADMIN_EMAIL). */
export function isAdminEmail(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const allowed = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!allowed || !email) return false;
  return email.trim().toLowerCase() === allowed;
}

/**
 * Credentials for one profile, in force order:
 *   1. the profile's own key (user_source_credentials)
 *   2. only when the profile IS the administrator, the global key
 *      (source_credentials)
 *   3. otherwise that source is simply not asked, and google_flights (which
 *      needs no key) keeps working. Nobody spends anyone else's quota.
 *
 * Environment variables are deliberately NOT part of this chain: they would be
 * a shared fallback for every user, which is exactly what this design avoids.
 */
export async function resolveSourceCredentialsForProfile(
  client: CredentialClient,
  profileId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedCredentials> {
  if (!hasMasterKey(env)) return NONE;

  let masterKey: Uint8Array<ArrayBuffer>;
  try {
    masterKey = parseMasterKey(env.SOURCE_SECRET_KEY);
  } catch {
    return NONE;
  }

  const userRows = await readRows(client, "user_source_credentials", (chain) =>
    chain.in("profile_id", [profileId]),
  );
  const own = await decryptRows(userRows, masterKey);
  if (own.serpapi && own.ignav) {
    return {
      serpapi: own.serpapi,
      ignav: own.ignav,
      serpapiOrigin: "user",
      ignavOrigin: "user",
    };
  }

  const { data: profile } = await client
    .from("profiles")
    .select("email")
    .eq("id", profileId)
    .maybeSingle();
  const email =
    profile && typeof profile === "object"
      ? (profile as { email?: unknown }).email
      : null;
  const admin = isAdminEmail(typeof email === "string" ? email : null, env);

  const global: { serpapi: string | null; ignav: string | null } = admin
    ? await decryptRows(
        await readRows(client, "source_credentials", (chain) =>
          chain.in("provider", CREDENTIAL_PROVIDERS),
        ),
        masterKey,
      )
    : { serpapi: null, ignav: null };

  const serpapi = own.serpapi ?? global.serpapi;
  const ignav = own.ignav ?? global.ignav;

  return {
    serpapi,
    ignav,
    serpapiOrigin: own.serpapi ? "user" : global.serpapi ? "global" : "none",
    ignavOrigin: own.ignav ? "user" : global.ignav ? "global" : "none",
  };
}

/**
 * Same, but a broken client (or a database error) must not fail a search:
 * the run falls back to "no API keys", which still leaves google_flights.
 */
export async function resolveSourceCredentialsForProfileSafe(
  createClient: () => CredentialClient,
  profileId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedCredentials> {
  try {
    return await resolveSourceCredentialsForProfile(createClient(), profileId, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[credentials] sin acceso al almacen de credenciales, seguira solo con google_flights: ${message}`,
    );
    return NONE;
  }
}

/** Which providers this profile has a key for, without decrypting them. */
export async function readStoredUserCredentialProviders(
  client: CredentialClient,
  profileId: string,
): Promise<CredentialProvider[]> {
  const rows = await readRows(client, "user_source_credentials", (chain) =>
    chain.in("profile_id", [profileId]),
  );
  return rows.filter((row) => isProvider(row.provider)).map((row) => row.provider as CredentialProvider);
}

/** Which providers have a global key, without decrypting it. */
export async function readStoredCredentialProviders(
  client: CredentialClient,
): Promise<CredentialProvider[]> {
  const rows = await readRows(client, "source_credentials", (chain) =>
    chain.in("provider", CREDENTIAL_PROVIDERS),
  );
  return rows.filter((row) => isProvider(row.provider)).map((row) => row.provider as CredentialProvider);
}
