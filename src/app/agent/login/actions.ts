'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { asRpc, type StaffLoginAttemptResult, type StaffSessionLoginResult } from '@/lib/rpc'
import { STAFF_SESSION_COOKIE, STAFF_SESSION_COOKIE_OPTIONS } from '@/lib/staff-session'

/**
 * Agent back-office login.
 *
 * S-1 FIX — see the note in ../../superadmin/login/actions.ts. This action had
 * the identical defect: it selected the non-existent `profiles.status` column,
 * so the role check silently fell back to user-writable metadata and the
 * suspension check could never fire.
 */
export async function agentLogin(formData: FormData) {
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!username || !password) {
    redirect('/agent/login?error=Please enter both username and password.')
  }

  const email = username.includes('@')
    ? username.toLowerCase()
    : `${username.toLowerCase()}@bestsmartgame.com`

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    redirect('/agent/login?error=Server configuration error.')
  }
  const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const supabase = await createClient()

  // Brute-force lockout, checked BEFORE the real sign-in attempt -- same
  // pattern as attempt_player_login, adapted for staff. Catches both an
  // already-locked/blocked account (no point even trying the password) and
  // counts this attempt if it's wrong, auto-locking on the 5th. Called via
  // the regular client (anon-key equivalent), not the admin client -- the
  // RPC is specifically granted to anon/authenticated for this pre-auth use.
  const { data: attemptData } = await supabase.rpc('attempt_staff_login', {
    p_username: username,
    p_password: password,
  })
  const attemptResult = attemptData ? asRpc<StaffLoginAttemptResult>(attemptData) : null
  if (attemptResult && attemptResult.success === false) {
    if (attemptResult.reason === 'account_blocked') {
      redirect('/agent/login?error=Your Agent account is suspended, contact your admin for unblock')
    }
    // Mirrors bsg_app's ApiService.login wording for the same underlying
    // attempt_staff_login/attempt_player_login attempts_remaining contract.
    const remaining = attemptResult.attempts_remaining
    const message = remaining != null
      ? `Invalid username or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before this account is temporarily locked.`
      : 'Invalid username or password.'
    redirect(`/agent/login?error=${message}`)
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    // Defensive backstop only -- attempt_staff_login above already catches a
    // blocked account before this point in the normal case. Kept in case
    // that check is ever skipped (e.g. the RPC call itself failing), same
    // "backstop still applies" reasoning used elsewhere in this codebase
    // (Issue #1's Layer A/B, agent_transfer_coins's RPC-level check).
    const { data: blockedProfile } = await supabaseAdmin
      .from('profiles')
      .select('is_active')
      .eq('email', email)
      .eq('role', 'agent')
      .maybeSingle()
    if (blockedProfile && !blockedProfile.is_active) {
      redirect('/agent/login?error=Your Agent account is suspended, contact your admin for unblock')
    }
    redirect('/agent/login?error=Invalid username or password.')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .single()

  if (profileError || !profile) {
    await supabase.auth.signOut({ scope: 'local' })
    redirect('/agent/login?error=Account could not be verified.')
  }

  if (!profile.is_active) {
    await supabase.auth.signOut({ scope: 'local' })
    redirect('/agent/login?error=Your Agent account is suspended, contact your admin for unblock')
  }

  if (profile.role === 'superadmin') {
    await supabase.auth.signOut({ scope: 'local' })
    redirect('/agent/login?error=SuperAdmin accounts must sign in at /superadmin/login.')
  }

  if (profile.role === 'player') {
    await supabase.auth.signOut({ scope: 'local' })
    redirect('/agent/login?error=Player accounts must sign in through the game app.')
  }

  if (profile.role !== 'agent') {
    await supabase.auth.signOut({ scope: 'local' })
    redirect('/agent/login?error=Unauthorized account role.')
  }

  // Single-device enforcement -- refuses outright if another device's
  // session is still within the 6h safety-net window (game_config's
  // staff_session_grace_sec). No convenient auto-swap; the only intended
  // way past this is an explicit logout on the first device. Checked last,
  // after every other rejection reason above, so a claim is never made for
  // a login that was going to be refused anyway for an unrelated reason.
  const sessionToken = randomUUID()
  const { data: sessionData } = await supabase.rpc('staff_session_login', {
    p_session_token: sessionToken,
  })
  const sessionResult = sessionData ? asRpc<StaffSessionLoginResult>(sessionData) : null
  if (!sessionResult?.allowed) {
    // scope: 'local' is load-bearing here, not stylistic. supabase-js
    // defaults signOut() to 'global' -- confirmed live via Supabase's own
    // auth logs as the actual cause of a real incident: an unscoped
    // signOut() here, cleaning up THIS refused device's just-created
    // session, was silently revoking the OTHER device's legitimate session
    // too (same account, global scope kills every session for it). That
    // produced exactly the symptom being refused here ("already logged in
    // elsewhere") while simultaneously destroying the elsewhere it was
    // referring to.
    await supabase.auth.signOut({ scope: 'local' })
    if (sessionResult?.reason === 'account_blocked') {
      redirect('/agent/login?error=Your Agent account is suspended, contact your admin for unblock')
    }
    redirect('/agent/login?error=Already logged in on another device. Please sign out there first.')
  }

  const cookieStore = await cookies()
  cookieStore.set(STAFF_SESSION_COOKIE, sessionToken, STAFF_SESSION_COOKIE_OPTIONS)

  redirect('/agent')
}
