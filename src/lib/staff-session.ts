/**
 * Single source of truth for the staff single-device session cookie's name
 * and options -- set at login (agent/superadmin login actions), read on
 * every request (requireAuth), and cleared at logout (signOutAction). All
 * three need to agree exactly on the cookie name; defining it once here
 * instead of as a repeated string literal in four places removes the risk
 * of one of them drifting out of sync with the others.
 *
 * Deliberately NOT the Supabase access token -- that rotates silently in the
 * background over a session this long (6h safety net), which would cause
 * random false "logged in elsewhere" failures if compared directly. This is
 * an independent, application-minted value that only ever changes at a real
 * login.
 */
export const STAFF_SESSION_COOKIE = 'bsg_staff_session'

export const STAFF_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  // 30 days -- outlives any realistic browser session. Actual validity is
  // enforced server-side via staff_session_touch/game_config's
  // staff_session_grace_sec, not by this cookie's own expiry; this is just
  // long enough that the cookie itself is never the reason someone gets
  // logged out.
  maxAge: 60 * 60 * 24 * 30,
}
