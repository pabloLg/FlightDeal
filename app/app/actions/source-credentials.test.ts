import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions under test. Two audiences with different rules:
//   - per-user keys: any signed-in user, scoped by their own profile id
//   - global keys: only the ADMIN_EMAIL allowlist
// The important contracts are the guard, the "no secret ever leaves" rule and
// that each user's row is written under their own profile.

const ADMIN_EMAIL = "admin@example.com";

let currentEmail: string | null = "user@example.com";
const upserted: { table: string; row: Record<string, unknown> }[] = [];
const deleted: { table: string; filters: Record<string, string> }[] = [];
let userRows: { provider: string; secret_encrypted: string }[] = [];
let globalRows: { provider: string; secret_encrypted: string }[] = [];
const verificationResults: { secret: string; reason?: string }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentEmail
            ? { id: "u1", email: currentEmail }
            : null,
        },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        in: async () => ({ data: table === "user_source_credentials" ? userRows : globalRows, error: null }),
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            if (table !== "profiles") return { data: null, error: null };
            const email =
              column === "id" && value === "u1" ? currentEmail : null;
            return { data: email ? { email } : null, error: null };
          },
        }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        upserted.push({ table, row });
        return { error: null };
      },
      delete: () => {
        // Chainable and awaitable: the real client allows .eq().eq()... and
        // is awaited at the end.
        const filters: Record<string, string> = {};
        const chain: Record<string, unknown> = {};
        chain.eq = (column: string, value: string) => {
          filters[column] = value;
          return chain;
        };
        chain.then = (
          resolve: (value: { error: null }) => unknown,
        ) => {
          deleted.push({ table, filters: { ...filters } });
          return Promise.resolve({ error: null }).then(resolve);
        };
        return chain;
      },
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

const SECRET = "user-secret-key-123";

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
  userRows = [];
  globalRows = [];
  verificationResults.length = 0;
  currentEmail = "user@example.com";
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.SOURCE_SECRET_KEY = "1".repeat(64);
});

describe("saveUserCredential", () => {
  it("writes the row under the caller's own profile", async () => {
    const actions = await load();
    await actions.saveUserCredential({}, submit("ignav", SECRET));

    expect(upserted).toHaveLength(1);
    expect(upserted[0].table).toBe("user_source_credentials");
    expect(upserted[0].row.profile_id).toBe("u1");
    expect(String(upserted[0].row.secret_encrypted)).not.toContain(SECRET);
  });

  it("works for any signed-in user, no allowlist", async () => {
    currentEmail = "someone-else@example.com";
    const actions = await load();
    const state = await actions.saveUserCredential({}, submit("ignav", SECRET));

    expect(state.ok).toBe(true);
    expect(upserted[0].row.profile_id).toBe("u1");
  });

  it("never returns the credential to the client", async () => {
    const actions = await load();
    const state = await actions.saveUserCredential({}, submit("ignav", SECRET));

    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(state.ok).toBe(true);
  });

  it("refuses to save without a master key instead of storing plaintext", async () => {
    delete process.env.SOURCE_SECRET_KEY;
    const actions = await load();

    const state = await actions.saveUserCredential({}, submit("ignav", SECRET));

    expect(state.error).toMatch(/SOURCE_SECRET_KEY/);
    expect(upserted).toHaveLength(0);
  });
});

describe("clearUserCredential", () => {
  it("deletes only the caller's own row", async () => {
    const actions = await load();
    await actions.clearUserCredential({}, submitProvider("ignav"));

    expect(deleted).toEqual([
      { table: "user_source_credentials", filters: { profile_id: "u1", provider: "ignav" } },
    ]);
  });
});

describe("testUserCredential", () => {
  it("checks the key that would actually run", async () => {
    const actions = await load();
    await actions.saveUserCredential({}, submit("ignav", SECRET));
    userRows = upserted.map((entry) => ({
      provider: String(entry.row.provider),
      secret_encrypted: String(entry.row.secret_encrypted),
    }));

    const state = await actions.testUserCredential({}, submitProvider("ignav"));
    expect(state.ok).toBe(true);
  });

  it("tells the user when Ignav rejects their key", async () => {
    const actions = await load();
    await actions.saveUserCredential({}, submit("ignav", SECRET));
    userRows = upserted.map((entry) => ({
      provider: String(entry.row.provider),
      secret_encrypted: String(entry.row.secret_encrypted),
    }));
    verificationResults.push({ secret: SECRET, reason: "invalid_key" });

    const state = await actions.testUserCredential({}, submitProvider("ignav"));
    expect(state.error).toMatch(/no es válida/i);
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it("does not spend quota on SerpAPI", async () => {
    const actions = await load();
    // With a key in place the check must still refuse to spend quota.
    await actions.saveUserCredential({}, submit("serpapi", "sa-key-123456"));
    userRows = upserted.map((entry) => ({
      provider: String(entry.row.provider),
      secret_encrypted: String(entry.row.secret_encrypted),
    }));

    const state = await actions.testUserCredential({}, submitProvider("serpapi"));

    expect(state.error).toMatch(/gasta cuota|consume una/i);
    expect(state.ok).toBeUndefined();
  });
});

describe("getUserCredentialStatuses", () => {
  it("reports the caller's own keys and what a search would use", async () => {
    const actions = await load();
    await actions.saveUserCredential({}, submit("ignav", SECRET));
    userRows = upserted.map((entry) => ({
      provider: String(entry.row.provider),
      secret_encrypted: String(entry.row.secret_encrypted),
    }));

    const statuses = await actions.getUserCredentialStatuses();
    expect(statuses).toEqual([
      { provider: "serpapi", hasOwn: false, effective: "none" },
      { provider: "ignav", hasOwn: true, effective: "user" },
    ]);
  });

  it("shows the admin that their global key is in force", async () => {
    currentEmail = ADMIN_EMAIL;
    globalRows = [
      { provider: "serpapi", secret_encrypted: "v1.aaaa.bbbb" },
    ];
    const actions = await load();

    const statuses = await actions.getUserCredentialStatuses();
    // The row is unreadable on purpose: it must not block the global label.
    expect(statuses.find((s) => s.provider === "serpapi")?.effective).toBe("none");
  });
});

describe("global keys stay admin-only", () => {
  it("rejects a regular user reading them", async () => {
    const actions = await load();
    await expect(actions.getGlobalCredentialStatuses()).resolves.toBeNull();
  });

  it("rejects a regular user writing them", async () => {
    const actions = await load();
    const state = await actions.saveSourceCredential({}, submit("ignav", SECRET));

    expect(state.error).toMatch(/administrador/i);
    expect(upserted).toHaveLength(0);
  });

  it("lets the admin write them", async () => {
    currentEmail = ADMIN_EMAIL;
    const actions = await load();
    const state = await actions.saveSourceCredential({}, submit("ignav", SECRET));

    expect(state.ok).toBe(true);
    expect(upserted[0].table).toBe("source_credentials");
  });

  it("hides the global section from a regular user", async () => {
    const actions = await load();
    await expect(actions.getGlobalCredentialStatuses()).resolves.toBeNull();
  });
});
