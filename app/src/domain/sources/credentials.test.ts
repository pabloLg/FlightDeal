import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  parseMasterKey,
  readStoredCredentials,
  redact,
  resolveFromEnv,
  resolveSourceCredentials,
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

describe("resolveFromEnv", () => {
  it("reads both keys, treating blank as absent", () => {
    expect(
      resolveFromEnv({ SERPAPI_API_KEY: "sa-1", IGNAV_API_KEY: "  " }),
    ).toEqual({ serpapi: "sa-1", ignav: null });
  });

  it("returns nulls when nothing is configured", () => {
    expect(resolveFromEnv({})).toEqual({ serpapi: null, ignav: null });
  });
});

const stubClient = (rows: { provider: string; secret_encrypted: string }[]) => ({
  from: () => ({
    select: () => ({
      in: async () => ({ data: rows, error: null }),
    }),
  }),
});

describe("readStoredCredentials", () => {
  it("decrypts stored rows", async () => {
    const serpapi = await encryptSecret("sa-stored", KEY);
    const ignav = await encryptSecret("ig-stored", KEY);
    const out = await readStoredCredentials(
      stubClient([
        { provider: "serpapi", secret_encrypted: serpapi },
        { provider: "ignav", secret_encrypted: ignav },
      ]),
      { SOURCE_SECRET_KEY: HEX_KEY },
    );
    expect(out).toEqual({ serpapi: "sa-stored", ignav: "ig-stored" });
  });

  it("skips a row it cannot decrypt", async () => {
    const out = await readStoredCredentials(
      stubClient([
        { provider: "serpapi", secret_encrypted: "v1.aaaa.bbbb" },
        { provider: "ignav", secret_encrypted: await encryptSecret("ig-ok", KEY) },
      ]),
      { SOURCE_SECRET_KEY: HEX_KEY },
    );
    expect(out).toEqual({ serpapi: null, ignav: "ig-ok" });
  });

  it("reads nothing without a master key", async () => {
    const out = await readStoredCredentials(
      stubClient([
        { provider: "serpapi", secret_encrypted: await encryptSecret("x", KEY) },
      ]),
      {},
    );
    expect(out.serpapi).toBeNull();
  });
});

describe("resolveSourceCredentials (precedence)", () => {
  it("environment wins over the stored value", async () => {
    const stored = await encryptSecret("sa-stored", KEY);
    const out = await resolveSourceCredentials(
      stubClient([{ provider: "serpapi", secret_encrypted: stored }]),
      { SERPAPI_API_KEY: "sa-env", SOURCE_SECRET_KEY: HEX_KEY },
    );
    expect(out.serpapi).toBe("sa-env");
    expect(out.serpapiOrigin).toBe("env");
  });

  it("falls back to the stored value and labels its origin", async () => {
    const stored = await encryptSecret("sa-stored", KEY);
    const out = await resolveSourceCredentials(
      stubClient([{ provider: "serpapi", secret_encrypted: stored }]),
      { SOURCE_SECRET_KEY: HEX_KEY },
    );
    expect(out.serpapi).toBe("sa-stored");
    expect(out.serpapiOrigin).toBe("database");
  });

  it("reports none when nothing is configured", async () => {
    const out = await resolveSourceCredentials(stubClient([]), {});
    expect(out.serpapiOrigin).toBe("none");
    expect(out.ignavOrigin).toBe("none");
  });

  it("keeps the environment value when there is no database client", async () => {
    const out = await resolveSourceCredentials(null, { IGNAV_API_KEY: "ig-env" });
    expect(out.ignav).toBe("ig-env");
    expect(out.ignavOrigin).toBe("env");
  });
});
