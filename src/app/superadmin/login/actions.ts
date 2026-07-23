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
      : `${username.toLowerCase()}@bsg.com`
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    redirect(`/superadmin/login?error=${encodeURIComponent(error?.message || 'Invalid username or password')}`)
  }

  const cookieStore = await cookies()
  cookieStore.set('mock_session', 'superadmin', { path: '/' })

  redirect('/superadmin')
}
