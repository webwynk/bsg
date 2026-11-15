'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase'
import { STAFF_SESSION_COOKIE } from '@/lib/staff-session'
import { asRpc, type StaffSessionTouchResult } from '@/lib/rpc'
import { shouldReleaseSeatOnSignOut } from '@/lib/sign-out-seat'

export async function signOutAction(redirectTo: string = '/agent/login') {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(STAFF_SESSION_COOKIE)?.value

  // Free the seat only if this browser still owns it (2026-11-15). Without
  // this, Sign out on an old, already-replaced tab would delete the seat of
  // the device that signed in after it, because session_logout deletes by
  // user, not by browser. See src/lib/sign-out-seat.ts.
  let releaseSeat = false
  if (sessionToken) {
    try {
      const { data: touchData, error: touchError } = await supabase.rpc('staff_session_touch', {
        p_session_token: sessionToken,
      })
      const touch = touchData ? asRpc<StaffSessionTouchResult>(touchData) : null
      releaseSeat = shouldReleaseSeatOnSignOut(sessionToken, touch, !!touchError)
    } catch {
      releaseSeat = false
    }
  }

  // Order matters: session_logout needs a still-valid auth.uid(), so it must
  // run before signOut -- same ordering the player app's own logout already
  // proves correct (see ApiService.logout()'s identical comment). Reused
  // as-is: session_logout is already fully role-agnostic (just deletes the
  // caller's own active_sessions row), no staff-specific version needed.
  // Only reached when this browser still owns the seat (see above).
  if (releaseSeat) {
    try {
      await supabase.rpc('session_logout')
    } catch {
      // Non-fatal -- proceed to sign out regardless. A failure here only
      // means the seat isn't freed until staff_session_grace_sec (180 s for
      // staff, counted from the tab's last keep-alive) runs out; it must
      // never be the reason a sign-out itself fails.
    }
  }

  // scope: 'local' -- supabase-js defaults signOut() to 'global', which signs
  // out EVERY device logged into this account, not just this one. Confirmed
  // live via Supabase's own auth logs as the actual root cause of repeated
  // "signed in from another device" false reports this session: a refused
  // login's cleanup elsewhere in this codebase was (before this fix) using
  // the same unscoped signOut(), silently killing the OTHER, legitimate
  // device's session too.
  await supabase.auth.signOut({ scope: 'local' })

  cookieStore.delete(STAFF_SESSION_COOKIE)

  redirect(redirectTo)
}
