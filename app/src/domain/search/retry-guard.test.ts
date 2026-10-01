import { describe, expect, it } from "vitest";

import { canRetry, RETRY_COOLDOWN_MS } from "./retry-guard";

const now = Date.parse("2026-09-29T08:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("canRetry", () => {
  it("allows the retry when the search never ran", () => {
    expect(canRetry(null, now)).toEqual({ ok: true });
  });

  it("refuses while an execution is in flight", () => {
    expect(canRetry({ status: "running", createdAt: ago(0) }, now)).toEqual({
      ok: false,
      reason: "execution_in_flight",
    });
    expect(canRetry({ status: "pending", createdAt: ago(0) }, now).ok).toBe(false);
  });

  it("refuses when the last run already completed", () => {
    expect(canRetry({ status: "completed", createdAt: ago(60_000) }, now)).toEqual({
      ok: false,
      reason: "last_execution_completed",
    });
  });

  it("allows a degraded or failed run right away", () => {
    expect(canRetry({ status: "degraded", createdAt: ago(1_000) }, now)).toEqual({ ok: true });
    expect(canRetry({ status: "failed", createdAt: ago(1_000) }, now)).toEqual({ ok: true });
  });

  it("rate-limits retries of retries", () => {
    const recent = { status: "degraded", createdAt: ago(60_000), isRetry: true };
    expect(canRetry(recent, now)).toEqual({ ok: false, reason: "cooldown" });
    expect(
      canRetry({ ...recent, createdAt: ago(RETRY_COOLDOWN_MS + 1) }, now),
    ).toEqual({ ok: true });
  });
});
