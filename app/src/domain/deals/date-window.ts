// Date window helpers for "last N days" queries.
//
// Deliberately outside components: the pages that use them are
// `force-dynamic` (rendered per request against the signed-in user's data),
// so a fresh "now" on every request is the intended behaviour, not an
// unstable re-render. Keeping it here also stops each page from repeating
// the same Date arithmetic.
export function isoDaysAgo(days: number): string {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since.toISOString().slice(0, 10);
}

// Strict YYYY-MM-DD of an option's first outbound departure. Scraper values
// are already date-only, so slicing is exact and never shifts across a
// timezone. Anything that is not an ISO date yields null, which the offer
// cards treat as "does not match the selected date".
export function outboundDepartDate(legs: unknown): string | null {
  const first = Array.isArray(legs) ? (legs[0] as { departAt?: unknown }) : null;
  const value = first?.departAt;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : null;
}

// Prices older than a day may already be gone: the search cron runs daily.
// Same threshold FreshnessChip renders. Living here (not in the component)
// keeps the Date.now() call out of a render body, where the purity lint rule
// would flag it.
export function isStale(checkedAt: string | null): boolean {
  if (!checkedAt) return false;
  const at = new Date(checkedAt).getTime();
  if (!Number.isFinite(at)) return false;
  return Date.now() - at > 24 * 60 * 60 * 1000;
}
