'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function agentLogin(formData: FormData) {
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!username || !password) {
    redirect('/agent/login?error=Please enter both username and password.')
  }

  const email = username.includes('@') ? username : `${username.toLowerCase()}@bestsmartgame.com`

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    redirect(`/agent/login?error=${encodeURIComponent(error?.message || 'Invalid username or password')}`)
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    redirect('/agent/login?error=Server configuration error.')
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

  if (profile?.status === 'blocked') {
    await supabase.auth.signOut()
    redirect('/agent/login?error=Account is suspended.')
  }

  if (userRole === 'superadmin') {
    await supabase.auth.signOut()
    redirect('/agent/login?error=Unauthorized. SuperAdmin accounts must log in at /superadmin/login.')
  }

  if (userRole === 'player') {
    await supabase.auth.signOut()
    redirect('/agent/login?error=Unauthorized. Player accounts must log in via the Game App.')
  }

  if (userRole !== 'agent') {
    await supabase.auth.signOut()
    redirect('/agent/login?error=Unauthorized account role.')
  }

  redirect('/agent')
}
