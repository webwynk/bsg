'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

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

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    redirect('/agent/login?error=Invalid username or password.')
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    await supabase.auth.signOut()
    redirect('/agent/login?error=Server configuration error.')
  }

  const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

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
    redirect('/agent/login?error=This account is suspended.')
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
