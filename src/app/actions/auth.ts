'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export async function signOutAction(redirectTo: string = '/agent/login') {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect(redirectTo)
}
