'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase'
import { asRpc, type StaffLoginAttemptResult, type StaffSessionLoginResult } from '@/lib/rpc'
import { STAFF_SESSION_COOKIE, STAFF_SESSION_COOKIE_OPTIONS } from '@/lib/staff-session'

/**
 * SuperAdmin portal login.
 *
 * S-1 FIX — the previous version ran:
 *     .select('role, status')
 * `profiles` has no `status` column (it has `is_active`), so the query always
 * failed with 42703, `profile` was always null, and the code fell through to
 *     const userRole = profile?.role || data.user.user_metadata?.role
 * i.e. straight back to the user-writable metadata the check existed to avoid.
 * The suspension check `profile?.status === 'blocked'` was likewise always
 * false, so a suspended superadmin could still log in.
 *
 * The role and the active flag are now read from real columns, and any failure
 * to read them denies the login rather than falling back.
 */
export async function superAdminLogin(formData: FormData) {
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!username || !password) {
    redirect('/superadmin/login?error=Please enter both username and password.')
  }

  // Identity convention, enforced in the database by a CHECK constraint:
  //   email = lower(username) || '@bestsmartgame.com'
  const email = username.includes('@')
    ? username.toLowerCase()
    : `${username.toLowerCase()}@bestsmartgame.com`

  const supabase = await createClient()

  // Same brute-force lockout as the agent portal (attempt_staff_login covers
  // both roles) -- the superadmin account is, if anything, the higher-value
  // target to protect, not a lower one.
  const { data: attemptData } = await supabase.rpc('attempt_staff_login', {
    p_username: username,
    p_password: password,
  })
  const attemptResult = attemptData ? asRpc<StaffLoginAttemptResult>(attemptData) : null
  if (attemptResult && attemptResult.success === false) {
    // Issue #21 FIX: attempt_staff_login checks is_active BEFORE verifying
    // the password, so this branch used to be reachable with any password
    // at all -- revealing "this account exists and is suspended" to anyone
    // testing a guessed/known username, no correct credentials required.
    // Now collapsed to the same generic message every other rejection
    // reason on this page uses; the real reason is still logged server-side.
    if (attemptResult.reason === 'account_blocked') {
      console.error(`[superAdminLogin] rejected: account suspended (username=${username})`)
      redirect('/superadmin/login?error=Invalid credentials or account not authorized for this portal.')
    }
    // Mirrors bsg_app's ApiService.login wording for the same underlying
    // attempt_staff_login/attempt_player_login attempts_remaining contract.
    const remaining = attemptResult.attempts_remaining
    const message = remaining != null
      ? `Invalid username or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before this account is temporarily locked.`
      : 'Invalid username or password.'
    redirect(`/superadmin/login?error=${message}`)
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    redirect('/superadmin/login?error=Invalid username or password.')
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    await supabase.auth.signOut({ scope: 'local' })
    redirect('/superadmin/login?error=Server configuration error.')
  }

  const supabaseAdmin = createAdminClient()

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .single()

  // Fail closed: no profile, no entry. No metadata fallback.
  // Issue #21 FIX: these 3 branches only fire once the password has already
  // been confirmed correct, and each used to return a different message
  // ("could not be verified" / "suspended" / "wrong role") -- letting anyone
  // who already has (or guesses) valid credentials for SOME account learn
  // that account's exact role and active-status. All 3 now return the same
  // generic message; the real reason is still logged server-side.
  if (profileError || !profile) {
    await supabase.auth.signOut({ scope: 'local' })
    console.error(`[superAdminLogin] rejected: profile could not be verified (user_id=${data.user.id})`)
    redirect('/superadmin/login?error=Invalid credentials or account not authorized for this portal.')
  }

  if (!profile.is_active) {
    await supabase.auth.signOut({ scope: 'local' })
    console.error(`[superAdminLogin] rejected: account suspended (username=${username})`)
    redirect('/superadmin/login?error=Invalid credentials or account not authorized for this portal.')
  }

  if (profile.role !== 'superadmin') {
    await supabase.auth.signOut({ scope: 'local' })
    console.error(`[superAdminLogin] rejected: wrong role (username=${username}, role=${profile.role})`)
    redirect('/superadmin/login?error=Invalid credentials or account not authorized for this portal.')
  }

  // Single-device enforcement -- same rule as the agent portal (both roles
  // share staff_session_login), checked last so a seat is never claimed for
  // a login that was going to be refused anyway for an unrelated reason.
  const sessionToken = randomUUID()
  const { data: sessionData } = await supabase.rpc('staff_session_login', {
    p_session_token: sessionToken,
  })
  const sessionResult = sessionData ? asRpc<StaffSessionLoginResult>(sessionData) : null
  if (!sessionResult?.allowed) {
    // scope: 'local' is load-bearing -- see the identical note in
    // ../../agent/login/actions.ts. supabase-js's signOut() defaults to
    // 'global' (every device for this account), which was confirmed live,
    // via Supabase's own auth logs, to be silently killing the OTHER,
    // legitimate device's session whenever a second device got refused here.
    await supabase.auth.signOut({ scope: 'local' })
    if (sessionResult?.reason === 'account_blocked') {
      redirect('/superadmin/login?error=This account is suspended.')
    }
    redirect('/superadmin/login?error=Already logged in on another device. Please sign out there first.')
  }

  const cookieStore = await cookies()
  cookieStore.set(STAFF_SESSION_COOKIE, sessionToken, STAFF_SESSION_COOKIE_OPTIONS)

  redirect('/superadmin')
}
