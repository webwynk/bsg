'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

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

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    redirect('/superadmin/login?error=Invalid username or password.')
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    await supabase.auth.signOut()
    redirect('/superadmin/login?error=Server configuration error.')
  }

  const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .single()

  // Fail closed: no profile, no entry. No metadata fallback.
  if (profileError || !profile) {
    await supabase.auth.signOut()
    redirect('/superadmin/login?error=Account could not be verified.')
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    redirect('/superadmin/login?error=This account is suspended.')
  }

  if (profile.role !== 'superadmin') {
    await supabase.auth.signOut()
    redirect('/superadmin/login?error=Unauthorized. Only SuperAdmin accounts can sign in here.')
  }

  redirect('/superadmin')
}
