'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase'
import { STAFF_SESSION_COOKIE } from '@/lib/staff-session'

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
