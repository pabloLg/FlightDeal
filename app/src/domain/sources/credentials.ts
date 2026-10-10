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
export type CredentialOrigin = "env" | "database" | "none";

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

export interface ResolvedCredentials {
  serpapi: string | null;
  ignav: string | null;
  /** Where each credential came from, so the UI can label it honestly. */
  serpapiOrigin: CredentialOrigin;
  ignavOrigin: CredentialOrigin;
}

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

// Minimal structural shape the Supabase client satisfies. Kept narrow on
// purpose: the module must be testable with a stub and must not depend on the
// generated database types, which would make the credential path fragile.
type CredentialQuery = {
  select: (columns: string) => {
    in: (
      column: string,
      values: string[],
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};

export type CredentialClient = {
  from: (table: string) => CredentialQuery;
};

type StoredRow = { provider?: unknown; secret_encrypted?: unknown };

/** Environment credentials only. Pure, so the precedence rule is testable. */
export function resolveFromEnv(
  env: Record<string, string | undefined> = process.env,
): { serpapi: string | null; ignav: string | null } {
  const read = (value: string | undefined) => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    serpapi: read(env.SERPAPI_API_KEY),
    ignav: read(env.IGNAV_API_KEY),
  };
}

/**
 * Stored credentials, decrypted. A failure (missing master key, wrong key,
 * database error) means "no stored credential" rather than an exception:
 * the chain must still run on environment variables.
 */
export async function readStoredCredentials(
  client: CredentialClient,
  env: Record<string, string | undefined> = process.env,
): Promise<{ serpapi: string | null; ignav: string | null }> {
  const empty = { serpapi: null, ignav: null };
  if (!hasMasterKey(env)) return empty;

  let masterKey: Uint8Array<ArrayBuffer>;
  try {
    masterKey = parseMasterKey(env.SOURCE_SECRET_KEY);
  } catch {
    return empty;
  }

  const { data, error } = await client
    .from("source_credentials")
    .select("provider, secret_encrypted")
    .in("provider", CREDENTIAL_PROVIDERS);

  if (error || !Array.isArray(data)) return empty;

  const out: { serpapi: string | null; ignav: string | null } = {
    serpapi: null,
    ignav: null,
  };
  for (const row of data as StoredRow[]) {
    if (typeof row.secret_encrypted !== "string") continue;
    if (row.provider !== "serpapi" && row.provider !== "ignav") continue;
    try {
      const secret = await decryptSecret(row.secret_encrypted, masterKey);
      out[row.provider] = secret;
    } catch {
      // Unreadable row: skip it. The environment variable still applies.
    }
  }
  return out;
}

/**
 * Same precedence rule, but a broken admin client (or a database error) must
 * not fail a search: the app falls back to environment-only credentials,
 * which is exactly how it behaved before stored credentials existed.
 */
export async function resolveSourceCredentialsSafe(
  createClient: () => CredentialClient,
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedCredentials> {
  try {
    return await resolveSourceCredentials(createClient(), env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[credentials] sin cliente administrador, se usan solo las variables de entorno: ${redact(message, [resolveFromEnv(env).serpapi, resolveFromEnv(env).ignav])}`,
    );
    const fromEnv = resolveFromEnv(env);
    return {
      serpapi: fromEnv.serpapi,
      ignav: fromEnv.ignav,
      serpapiOrigin: fromEnv.serpapi ? "env" : "none",
      ignavOrigin: fromEnv.ignav ? "env" : "none",
    };
  }
}
export async function resolveSourceCredentials(
  client: CredentialClient | null,
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedCredentials> {
  const fromEnv = resolveFromEnv(env);
  const stored = client ? await readStoredCredentials(client, env) : { serpapi: null, ignav: null };

  const pick = (envValue: string | null, storedValue: string | null) =>
    envValue
      ? { value: envValue, origin: "env" as CredentialOrigin }
      : storedValue
        ? { value: storedValue, origin: "database" as CredentialOrigin }
        : { value: null, origin: "none" as CredentialOrigin };

  const serpapi = pick(fromEnv.serpapi, stored.serpapi);
  const ignav = pick(fromEnv.ignav, stored.ignav);

  return {
    serpapi: serpapi.value,
    ignav: ignav.value,
    serpapiOrigin: serpapi.origin,
    ignavOrigin: ignav.origin,
  };
}
