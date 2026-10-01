// Guards the two service endpoints (scheduler tick, manual retry). Fail-closed on
// a missing secret: without it a template literal would compare against
// "Bearer undefined" and that header would authenticate anyone.
export function isAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  return header === `Bearer ${secret}`;
}
