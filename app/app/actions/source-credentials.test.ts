import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions under test: they guard a global, per-tenant-free settings
// section, so the guard and the "no secret leaks out" contract matter more
// than the happy path.

const ADMIN_EMAIL = "admin@example.com";

let currentEmail: string | null = ADMIN_EMAIL;
const upserted: Record<string, unknown>[] = [];
const deleted: { provider: string }[] = [];
let rows: { provider: string; secret_encrypted: string }[] = [];
const verificationResults: { secret: string; reason?: string }[] = [];

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentEmail ? { id: "u1", email: currentEmail } : null,
        },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        in: async () => ({ data: rows, error: null }),
        eq: (column: string, value: string) => ({
          maybeSingle: async () => ({
            data: rows.find((r) => r.provider === value) ?? null,
            error: null,
          }),
        }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        upserted.push({ ...row, table });
        return { error: null };
      },
      delete: () => ({
        eq: async (column: string, value: string) => {
          deleted.push({ provider: value });
          return { error: null };
        },
      }),
    }),
  }),
}));

vi.mock("@/src/domain/sources/ignav-source", () => ({
  IgnavFlightSource: class {
    constructor(readonly secret: string) {}
    async verifyCredential() {
      const reason = verificationResults.find((r) => r.secret === this.secret)?.reason;
      return reason ? { ok: false, reason } : { ok: true };
    }
  },
}));

const SECRET = "ignav-super-secret-key";
const HEX_KEY = "1".repeat(64);

const load = async () => await import("./source-credentials");

const submit = (provider: string, secret: string) => {
  const form = new FormData();
  form.set("provider", provider);
  form.set("secret", secret);
  return form;
};

const submitProvider = (provider: string) => {
  const form = new FormData();
  form.set("provider", provider);
  return form;
};

beforeEach(() => {
  upserted.length = 0;
  deleted.length = 0;
  verificationResults.length = 0;
  rows = [];
  currentEmail = ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.SOURCE_SECRET_KEY = HEX_KEY;
  // Both provider keys: a leftover from one test must not decide another.
  delete process.env.IGNAV_API_KEY;
  delete process.env.SERPAPI_API_KEY;
});

describe("authorisation", () => {
  it("rejects a non-admin without touching the database", async () => {
    currentEmail = "someone-else@example.com";
    const actions = await load();

    const result = await actions.saveSourceCredential(
      {},
      submit("ignav", SECRET),
    );

    expect(result.error).toMatch(/administrador/i);
    expect(upserted).toHaveLength(0);
  });

  it("rejects everyone when no admin is configured", async () => {
    delete process.env.ADMIN_EMAIL;
    currentEmail = ADMIN_EMAIL;
    const actions = await load();

    const result = await actions.saveSourceCredential(
      {},
      submit("ignav", SECRET),
    );

    expect(result.error).toMatch(/administrador/i);
    expect(upserted).toHaveLength(0);
  });

  it("hides the whole section from a non-admin", async () => {
    currentEmail = "someone-else@example.com";
    const actions = await load();

    await expect(actions.getCredentialStatuses()).resolves.toBeNull();
  });
});

describe("saveSourceCredential", () => {
  it("stores an encrypted payload, never the plaintext", async () => {
    const actions = await load();
    await actions.saveSourceCredential({}, submit("ignav", SECRET));

    expect(upserted).toHaveLength(1);
    const stored = upserted[0];
    expect(String(stored.secret_encrypted)).not.toContain(SECRET);
    expect(String(stored.secret_encrypted).startsWith("v1.")).toBe(true);
  });

  it("never returns the credential to the client", async () => {
    const actions = await load();
    const state = await actions.saveSourceCredential(
      {},
      submit("ignav", SECRET),
    );

    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain(SECRET);
    expect(state.ok).toBe(true);
  });

  it("refuses to save without a master key instead of storing plaintext", async () => {
    delete process.env.SOURCE_SECRET_KEY;
    const actions = await load();

    const state = await actions.saveSourceCredential(
      {},
      submit("ignav", SECRET),
    );

    expect(state.error).toMatch(/SOURCE_SECRET_KEY/);
    expect(upserted).toHaveLength(0);
  });

  it("rejects an unknown provider", async () => {
    const actions = await load();
    const state = await actions.saveSourceCredential(
      {},
      submit("amadeus", SECRET),
    );

    expect(state.error).toMatch(/desconocida/i);
    expect(upserted).toHaveLength(0);
  });
});

describe("clearSourceCredential", () => {
  it("deletes the stored row (reversal)", async () => {
    const actions = await load();
    const state = await actions.clearSourceCredential({}, submitProvider("ignav"));

    expect(state.ok).toBe(true);
    expect(deleted).toEqual([{ provider: "ignav" }]);
  });
});

describe("testSourceConnection", () => {
  it("checks Ignav with a real authenticated call, not the free status endpoint", async () => {
    const actions = await load();
    // Save first, then put the encrypted row where the database would have it.
    await actions.saveSourceCredential({}, submit("ignav", SECRET));
    rows = upserted.map((row) => ({
      provider: String(row.provider),
      secret_encrypted: String(row.secret_encrypted),
    }));

    const state = await actions.testSourceConnection({}, submitProvider("ignav"));

    expect(state.ok).toBe(true);
  });

  it("rejects a stored key that Ignav does not accept", async () => {
    const actions = await load();
    await actions.saveSourceCredential({}, submit("ignav", SECRET));
    rows = upserted.map((row) => ({
      provider: String(row.provider),
      secret_encrypted: String(row.secret_encrypted),
    }));
    verificationResults.push({ secret: SECRET, reason: "invalid_key" });

    const state = await actions.testSourceConnection({}, submitProvider("ignav"));

    expect(state.error).toMatch(/no es válida/i);
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it("says so plainly when there is no key to check", async () => {
    const actions = await load();
    const state = await actions.testSourceConnection({}, submitProvider("serpapi"));

    expect(state.error).toMatch(/No hay credencial configurada/i);
    expect(JSON.stringify(state)).not.toContain("serpapi-");
  });

  it("explains that SerpAPI cannot be checked without spending quota", async () => {
    process.env.SERPAPI_API_KEY = "sa-from-env";
    const actions = await load();
    const state = await actions.testSourceConnection(
      {},
      submitProvider("serpapi"),
    );

    expect(state.error).toMatch(/gasta cuota|consume una búsqueda/i);
    expect(JSON.stringify(state)).not.toContain("sa-from-env");
  });
});

describe("getCredentialStatuses", () => {
  it("labels where each credential comes from", async () => {
    const actions = await load();
    const statuses = await actions.getCredentialStatuses();

    // Nothing stored, no env: both report "none".
    expect(statuses).toEqual([
      { provider: "serpapi", origin: "none" },
      { provider: "ignav", origin: "none" },
    ]);
  });

  it("prefers the environment variable and says so", async () => {
    process.env.IGNAV_API_KEY = "ignav-from-env";
    const actions = await load();
    const statuses = await actions.getCredentialStatuses();

    expect(statuses?.find((s) => s.provider === "ignav")?.origin).toBe("env");
  });
});
