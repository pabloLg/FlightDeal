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
