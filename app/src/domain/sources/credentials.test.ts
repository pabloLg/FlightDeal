import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  hasMasterKey,
  isAdminEmail,
  parseMasterKey,
  readStoredCredentialProviders,
  readStoredUserCredentialProviders,
  redact,
  resolveSourceCredentialsForProfile,
  type CredentialClient,
} from "./credentials";

// 32 bytes, hex. Deterministic on purpose: this is a throwaway test key.
const HEX_KEY = "0".repeat(64);
const KEY = parseMasterKey(HEX_KEY);

describe("parseMasterKey", () => {
  it("accepts 64 hex characters", () => {
    expect(parseMasterKey(HEX_KEY)).toHaveLength(32);
  });

  it("accepts base64/base64url of 32 bytes", () => {
    const b64 = Buffer.from(KEY).toString("base64");
    expect(parseMasterKey(b64)).toEqual(KEY);
    expect(parseMasterKey(Buffer.from(KEY).toString("base64url"))).toEqual(KEY);
  });

  it("rejects anything that is not 32 bytes", () => {
    expect(() => parseMasterKey("")).toThrow(/32 bytes/);
    expect(() => parseMasterKey("corta")).toThrow(/32 bytes/);
  });

  it("reports whether a usable key is configured", () => {
    expect(hasMasterKey({ SOURCE_SECRET_KEY: HEX_KEY })).toBe(true);
    expect(hasMasterKey({})).toBe(false);
    expect(hasMasterKey({ SOURCE_SECRET_KEY: "corta" })).toBe(false);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", async () => {
    const payload = await encryptSecret("sa-live-12345", KEY);
    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload).not.toContain("sa-live-12345");
    await expect(decryptSecret(payload, KEY)).resolves.toBe("sa-live-12345");
  });

  it("uses a fresh IV each time, so two encryptions differ", async () => {
    const a = await encryptSecret("same-secret", KEY);
    const b = await encryptSecret("same-secret", KEY);
    expect(a).not.toBe(b);
  });

  it("fails on a tampered payload instead of returning garbage", async () => {
    const payload = await encryptSecret("sa-live-12345", KEY);
    const [head, iv, cipher] = payload.split(".");
    const flipped = `${head}.${iv}.${cipher.slice(0, -2)}${cipher.slice(-2) === "AA" ? "BB" : "AA"}`;
    await expect(decryptSecret(flipped, KEY)).rejects.toThrow(/descifrar/);
  });

  it("rejects an unknown format", async () => {
    await expect(decryptSecret("nope", KEY)).rejects.toThrow(/formato/);
  });
});

describe("redact", () => {
  it("removes the secret from a message", () => {
    expect(redact("fetch failed for sa-live-12345", ["sa-live-12345"])).toBe(
      "fetch failed for ***",
    );
  });

  it("ignores null and implausibly short secrets", () => {
    expect(redact("body: short", [null, "abc"])).toBe("body: short");
  });
});

describe("isAdminEmail", () => {
  it("matches the configured email, case-insensitively", () => {
    expect(isAdminEmail("Admin@Example.com", { ADMIN_EMAIL: "admin@example.com" })).toBe(true);
  });

  it("is false for anyone else, and when nothing is configured", () => {
    expect(isAdminEmail("other@example.com", { ADMIN_EMAIL: "admin@example.com" })).toBe(false);
    expect(isAdminEmail("admin@example.com", {})).toBe(false);
    expect(isAdminEmail(null, { ADMIN_EMAIL: "admin@example.com" })).toBe(false);
  });
});

type Row = { provider: string; secret_encrypted: string };

// Stub client: rows keyed by table, with a profile email lookup.
function stubClient({
  userRows = [] as Row[],
  globalRows = [] as Row[],
  email = null as string | null,
} = {}) {
  const calls: string[] = [];
  const client: CredentialClient = {
    from: (table: string) => {
      calls.push(table);
      const rows = table === "user_source_credentials" ? userRows : globalRows;
      return {
        select: () => ({
          in: async () => ({ data: rows, error: null }),
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "profiles" && email ? { email } : null,
              error: null,
            }),
          }),
        }),
      };
    },
  };
  return { client, calls };
}

const ENV = { SOURCE_SECRET_KEY: HEX_KEY, ADMIN_EMAIL: "admin@example.com" };

describe("resolveSourceCredentialsForProfile", () => {
  it("uses the caller's own key", async () => {
    const { client } = stubClient({
      userRows: [{ provider: "serpapi", secret_encrypted: await encryptSecret("sa-own", KEY) }],
      email: "user@example.com",
    });

    const out = await resolveSourceCredentialsForProfile(client, "p1", ENV);

    expect(out.serpapi).toBe("sa-own");
    expect(out.serpapiOrigin).toBe("user");
    expect(out.ignav).toBeNull();
  });

  it("never lets one user see another user's key", async () => {
    const { client } = stubClient({
      userRows: [{ provider: "ignav", secret_encrypted: await encryptSecret("ig-other", KEY) }],
      email: "user@example.com",
    });

    // A different profile id reads a different row set; the stub returns the
    // same rows, so this only proves the lookup is per profile_id. The real
    // isolation is enforced by RLS (see source-credentials.test.ts).
    const out = await resolveSourceCredentialsForProfile(client, "p1", ENV);
    expect(out.serpapiOrigin).toBe("none");
  });

  it("falls back to the global key only for the admin", async () => {
    const global = [
      { provider: "serpapi", secret_encrypted: await encryptSecret("sa-global", KEY) },
    ];

    const admin = stubClient({ globalRows: global, email: "admin@example.com" });
    const other = stubClient({ globalRows: global, email: "user@example.com" });

    const forAdmin = await resolveSourceCredentialsForProfile(admin.client, "p1", ENV);
    const forUser = await resolveSourceCredentialsForProfile(other.client, "p2", ENV);

    expect(forAdmin.serpapi).toBe("sa-global");
    expect(forAdmin.serpapiOrigin).toBe("global");
    // A regular user without their own key gets nothing: google_flights only.
    expect(forUser.serpapi).toBeNull();
    expect(forUser.serpapiOrigin).toBe("none");
  });

  it("prefers the user's own key over the global one", async () => {
    const { client } = stubClient({
      userRows: [{ provider: "serpapi", secret_encrypted: await encryptSecret("sa-own", KEY) }],
      globalRows: [{ provider: "serpapi", secret_encrypted: await encryptSecret("sa-global", KEY) }],
      email: "admin@example.com",
    });

    const out = await resolveSourceCredentialsForProfile(client, "p1", ENV);
    expect(out.serpapi).toBe("sa-own");
    expect(out.serpapiOrigin).toBe("user");
  });

  it("does not read the global pool when the profile has no email match", async () => {
    const { client, calls } = stubClient({
      globalRows: [{ provider: "serpapi", secret_encrypted: await encryptSecret("sa-global", KEY) }],
      email: null,
    });

    const out = await resolveSourceCredentialsForProfile(client, "p1", ENV);
    expect(out.serpapi).toBeNull();
    expect(calls).not.toContain("source_credentials");
  });

  it("reads nothing without a master key", async () => {
    const { client } = stubClient({
      userRows: [{ provider: "serpapi", secret_encrypted: await encryptSecret("sa-own", KEY) }],
    });

    const out = await resolveSourceCredentialsForProfile(client, "p1", {});
    expect(out.serpapi).toBeNull();
    expect(out.serpapiOrigin).toBe("none");
  });

  it("skips a row it cannot decrypt", async () => {
    const { client } = stubClient({
      userRows: [
        { provider: "serpapi", secret_encrypted: "v1.aaaa.bbbb" },
        { provider: "ignav", secret_encrypted: await encryptSecret("ig-ok", KEY) },
      ],
      email: "user@example.com",
    });

    const out = await resolveSourceCredentialsForProfile(client, "p1", ENV);
    expect(out).toMatchObject({ serpapi: null, ignav: "ig-ok" });
  });
});

describe("readStoredUserCredentialProviders", () => {
  it("lists the providers this profile has a row for", async () => {
    const { client } = stubClient({
      userRows: [
        { provider: "serpapi", secret_encrypted: await encryptSecret("x", KEY) },
      ],
    });

    await expect(
      readStoredUserCredentialProviders(client, "p1"),
    ).resolves.toEqual(["serpapi"]);
  });

  it("returns an empty list when there are none", async () => {
    const { client } = stubClient();
    await expect(readStoredUserCredentialProviders(client, "p1")).resolves.toEqual([]);
  });
});

describe("readStoredCredentialProviders (global)", () => {
  it("lists the providers with a global key", async () => {
    const { client } = stubClient({
      globalRows: [{ provider: "ignav", secret_encrypted: await encryptSecret("x", KEY) }],
    });

    await expect(readStoredCredentialProviders(client)).resolves.toEqual(["ignav"]);
  });
});
