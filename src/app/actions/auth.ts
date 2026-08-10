'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase'
import { asRpc, type StaffSessionTouchResult } from '@/lib/rpc'
import { STAFF_SESSION_COOKIE } from '@/lib/staff-session'

export type SessionCheckStatus = 'valid' | 'superseded' | 'unknown'

/**
 * Polled every 30s by SessionGuardProvider (mounted once per portal layout)
 * so a device that's lost its seat -- superseded by a login elsewhere, or
 * suspended while it was sitting idle -- finds out within 30s instead of
 * only on its next real button click.
 *
 * Deliberately does NOT reuse requireAuth() here. requireAuth does THREE
 * separate network calls (getUser, an admin-client profile fetch,
 * staff_session_touch) -- more surface area for an unrelated transient
 * failure to occur, and every one of its failure reasons collapses into a
 * single generic error, indistinguishable from a genuine "another device
 * took your seat."
 *
 * That distinction matters a lot here: this app runs two independent
 * background pollers in the same portal (AgentNotificationsProvider @15s,
 * this one @30s). Supabase refresh tokens are single-use; if two pollers'
 * requests land close together right as the access token is due for a
 * silent refresh, one of them can get a genuine "refresh token already
 * used" rejection from Supabase -- a real, reproducible collision between
 * this app's own polling loops, nothing to do with connection quality.
 * Treating that the same as a real supersession was a real bug (confirmed
 * live: the active_sessions row never changed, yet the UI still forced a
 * sign-out blaming "another device"). So: only a clean, successful RPC
 * response that explicitly says `valid: false` counts as 'superseded'.
 * Anything else that goes wrong along the way is 'unknown' -- the caller
 * ignores it and just tries again next cycle, since the real security gate
 * is still enforced by every actual action's own requireAuth() call
 * regardless of what this background poll concludes.
 */
export async function checkSessionAction(): Promise<{ status: SessionCheckStatus }> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      // Could be a genuine sign-out, or just this specific call colliding
      // with another poller's token refresh -- not proof of supersession.
      return { status: 'unknown' }
    }

    const cookieStore = await cookies()
    const sessionToken = cookieStore.get(STAFF_SESSION_COOKIE)?.value
    if (!sessionToken) {
      // No device cookie at all, but a valid login -- unambiguous: this
      // browser was never the one holding the seat (or was fully signed
      // out of it), not a transient hiccup.
      return { status: 'superseded' }
    }

    const { data: touchData, error: touchError } = await supabase.rpc('staff_session_touch', {
      p_session_token: sessionToken,
    })
    if (touchError) {
      // The RPC call itself failed to complete -- not the same as it
      // completing and reporting invalid. Don't act on a dropped request.
      return { status: 'unknown' }
    }

    const result = touchData ? asRpc<StaffSessionTouchResult>(touchData) : null
    return { status: result?.valid ? 'valid' : 'superseded' }
  } catch {
    return { status: 'unknown' }
  }
}

export async function signOutAction(redirectTo: string = '/agent/login') {
  const supabase = await createClient()

  // Order matters: session_logout needs a still-valid auth.uid(), so it must
  // run before signOut -- same ordering the player app's own logout already
  // proves correct (see ApiService.logout()'s identical comment). Reused
  // as-is: session_logout is already fully role-agnostic (just deletes the
  // caller's own active_sessions row), no staff-specific version needed.
  try {
    await supabase.rpc('session_logout')
  } catch {
    // Non-fatal -- proceed to sign out regardless. A failure here only
    // means the seat isn't freed until the 6h safety net catches it; it
    // must never be the reason a sign-out itself fails.
  }

  await supabase.auth.signOut()

  const cookieStore = await cookies()
  cookieStore.delete(STAFF_SESSION_COOKIE)

  redirect(redirectTo)
}

/**
 * Used ONLY by SessionGuardProvider when checkSessionAction reports the
 * session is no longer valid. Deliberately does NOT call session_logout()
 * the way signOutAction does.
 *
 * Why: session_logout() deletes active_sessions WHERE user_id = auth.uid(),
 * with no session-token check -- correct for a real, currently-valid device
 * signing itself out (it owns the one row that exists for that user_id), but
 * wrong here. By the time this runs, THIS device has already lost the seat,
 * which means the active_sessions row for this user_id now belongs to the
 * device that superseded it. Calling session_logout() here would delete
 * that row and silently kick out the device that's supposed to be the
 * winner -- the exact "silent auto-swap" the whole feature was built to
 * prevent, just arriving from the wrong side. This function only tears down
 * what belongs to THIS device alone: its own Supabase Auth token and its own
 * cookie, never the shared active_sessions row.
 */
export async function forceSignOutAction(redirectTo: string) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const cookieStore = await cookies()
  cookieStore.delete(STAFF_SESSION_COOKIE)

  redirect(redirectTo)
}
