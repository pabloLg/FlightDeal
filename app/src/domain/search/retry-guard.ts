// D6: the audited manual retry. Fail-closed means a blocked run stays
// `degraded` with no prices, so the only recovery is an operator asking for the
// same search again; this decides whether that request is allowed at all.
export const RETRY_COOLDOWN_MS = 15 * 60_000;

export type LatestExecution = {
  status: string;
  createdAt: string | null;
  // True when the latest execution was itself an admin retry, which is what
  // the cooldown rate-limits. A fresh failure from the cron is retryable at
  // once: the operator usually just fixed the reason it broke.
  isRetry?: boolean;
};

export type RetryVerdict = { ok: true } | { ok: false; reason: string };

export function canRetry(
  latest: LatestExecution | null,
  nowMs: number,
  cooldownMs = RETRY_COOLDOWN_MS,
): RetryVerdict {
  if (!latest) return { ok: true };

  if (latest.status === "pending" || latest.status === "running") {
    return { ok: false, reason: "execution_in_flight" };
  }
  if (latest.status === "completed") {
    return { ok: false, reason: "last_execution_completed" };
  }
  if (latest.isRetry && latest.createdAt) {
    const age = nowMs - new Date(latest.createdAt).getTime();
    if (Number.isFinite(age) && age < cooldownMs) {
      return { ok: false, reason: "cooldown" };
    }
  }
  return { ok: true };
}
