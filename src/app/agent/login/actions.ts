'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { asRpc, type StaffLoginAttemptResult } from '@/lib/rpc'

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
    redirect('/agent/login?error=Invalid username or password.')
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
    await supabase.auth.signOut()
    redirect('/agent/login?error=Account could not be verified.')
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    redirect('/agent/login?error=Your Agent account is suspended, contact your admin for unblock')
  }

  if (profile.role === 'superadmin') {
    await supabase.auth.signOut()
    redirect('/agent/login?error=SuperAdmin accounts must sign in at /superadmin/login.')
  }

  if (profile.role === 'player') {
    await supabase.auth.signOut()
    redirect('/agent/login?error=Player accounts must sign in through the game app.')
  }

  if (profile.role !== 'agent') {
    await supabase.auth.signOut()
    redirect('/agent/login?error=Unauthorized account role.')
  }

  redirect('/agent')
}
