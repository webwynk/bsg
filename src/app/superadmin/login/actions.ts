'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export async function superAdminLogin(formData: FormData) {
  const email = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!email || !password) {
    redirect('/superadmin/login?error=Please enter both email and password.')
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    redirect(`/superadmin/login?error=${encodeURIComponent(error?.message || 'Invalid credentials')}`)
  }

  const cookieStore = await cookies()
  cookieStore.set('mock_session', 'superadmin', { path: '/' })

  redirect('/superadmin')
}
