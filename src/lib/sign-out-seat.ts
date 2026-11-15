/**
 * Decides whether Sign out may free the account's login seat
 * (active_sessions row) by calling session_logout.
 *
 * Why this exists (2026-11-15, found in the review of dashboard server-call
 * optimisation step 1): session_logout deletes the seat by USER, not by
 * browser. If this browser's tab was already replaced (the 3-minute lock ran
 * out and the same account signed in on another device), freeing the seat
 * from here would delete the OTHER device's seat and its next refresh would
 * say "signed in from another device". Before step 1, src/proxy.ts refused
 * such a tab before signOutAction ran; server actions now skip the proxy
 * check, so signOutAction checks for itself.
 *
 * Free the seat only when this browser has a session cookie AND
 * staff_session_touch answered, without error, that this cookie still owns
 * the seat. Anything else (no cookie, replaced, or the check itself failed)
 * keeps the seat: this browser is still signed out, and a seat that really
 * was ours frees itself after staff_session_grace_sec (180 s) anyway.
 */
export function shouldReleaseSeatOnSignOut(
  sessionToken: string | null | undefined,
  touch: { valid?: unknown } | null | undefined,
  touchFailed: boolean
): boolean {
  if (!sessionToken) return false
  if (touchFailed) return false
  return touch?.valid === true
}
