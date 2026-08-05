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
  const email = username.includes('@') ? username : `${username.toLowerCase()}@bestsmartgame.com`

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    redirect(`/agent/login?error=${encodeURIComponent(error?.message || 'Invalid username or password')}`)
  }

  // Strict RBAC: Ensure SuperAdmin and Player accounts cannot log into Agent portal
  const userRole = data.user.user_metadata?.role
  if (userRole === 'superadmin' || email.toLowerCase().includes('admin@bestsmartgame.com')) {
    const supabaseClient = await createClient()
    await supabaseClient.auth.signOut()
    const cookieStore = await cookies()
    cookieStore.delete('mock_session')
    redirect('/agent/login?error=Unauthorized. SuperAdmin accounts must log in at /superadmin/login.')
  }

  if (userRole === 'player') {
    const supabaseClient = await createClient()
    await supabaseClient.auth.signOut()
    const cookieStore = await cookies()
    cookieStore.delete('mock_session')
    redirect('/agent/login?error=Unauthorized. Player accounts must log in via the Game App.')
  }

  if (userRole && userRole !== 'agent') {
    const supabaseClient = await createClient()
    await supabaseClient.auth.signOut()
    const cookieStore = await cookies()
    cookieStore.delete('mock_session')
    redirect('/agent/login?error=Unauthorized account role.')
  }

  const cookieStore = await cookies()
  cookieStore.set('mock_session', 'agent', { path: '/' })

  redirect('/agent')
}

