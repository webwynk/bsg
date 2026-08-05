'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export async function superAdminLogin(formData: FormData) {
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!username || !password) {
    redirect('/superadmin/login?error=Please enter both username and password.')
  }

  let email = username
  if (!username.includes('@')) {
    // If username is 'admin', automatically resolve to admin@bestsmartgame.com
    email = username.toLowerCase() === 'admin' 
      ? 'admin@bestsmartgame.com' 
      : `${username.toLowerCase()}@bestsmartgame.com`
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    redirect(`/superadmin/login?error=${encodeURIComponent(error?.message || 'Invalid username or password')}`)
  }

  // Strict RBAC: Ensure non-SuperAdmin accounts cannot log into SuperAdmin portal
  const userRole = data.user.user_metadata?.role
  const isSuperAdmin = userRole === 'superadmin' || email.toLowerCase() === 'admin@bestsmartgame.com' || username.toLowerCase() === 'admin'

  if (!isSuperAdmin) {
    const supabaseClient = await createClient()
    await supabaseClient.auth.signOut()
    const cookieStore = await cookies()
    cookieStore.delete('mock_session')
    redirect('/superadmin/login?error=Unauthorized access. Only SuperAdmin accounts can log in here.')
  }

  const cookieStore = await cookies()
  cookieStore.set('mock_session', 'superadmin', { path: '/' })

  redirect('/superadmin')
}

