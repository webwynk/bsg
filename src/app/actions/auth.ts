'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { STAFF_SESSION_COOKIE } from '@/lib/staff-session'

/**
 * Polled every 30s by SessionGuardProvider (mounted once per portal layout)
 * so a device that's lost its seat -- superseded by a login elsewhere, or
 * suspended while it was sitting idle -- finds out within 30s instead of
 * only on its next real button click. Reuses requireAuth as the single
 * source of truth for "is this session still good" rather than
 * re-implementing the check here.
 */
export async function checkSessionAction(): Promise<{ valid: boolean }> {
  const result = await requireAuth(['agent', 'superadmin'])
  return { valid: !result.error }
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
