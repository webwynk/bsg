'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export async function agentLogin(formData: FormData) {
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!username || !password) {
    redirect('/agent/login?error=Please enter both username and password.')
  }

  // Support pure username by converting to internal format if @ isn't present
  const email = username.includes('@') ? username : `${username.toLowerCase()}@bsg.com`

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    redirect(`/agent/login?error=${encodeURIComponent(error?.message || 'Invalid username or password')}`)
  }

  const cookieStore = await cookies()
  cookieStore.set('mock_session', 'agent', { path: '/' })

  redirect('/agent')
}
