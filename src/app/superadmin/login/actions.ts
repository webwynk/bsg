'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function superAdminLogin(formData: FormData) {
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!username || !password) {
    redirect('/superadmin/login?error=Please enter both username and password.')
  }

  let email = username
  if (!username.includes('@')) {
    email = `${username.toLowerCase()}@bestsmartgame.com`
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    redirect(`/superadmin/login?error=${encodeURIComponent(error?.message || 'Invalid username or password')}`)
  }

  // Strict RBAC: Check role from profiles table via service client
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    redirect('/superadmin/login?error=Server configuration error.')
  }

  const supabaseAdmin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  )

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status')
    .eq('id', data.user.id)
    .single()

  const userRole = profile?.role || data.user.user_metadata?.role

  if (userRole !== 'superadmin' || profile?.status === 'blocked') {
    await supabase.auth.signOut()
    redirect('/superadmin/login?error=Unauthorized access. Only SuperAdmin accounts can log in here.')
  }

  redirect('/superadmin')
}
