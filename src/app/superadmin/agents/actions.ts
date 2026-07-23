'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase'

export async function createAgentAction(formData: FormData) {
  const name = (formData.get('name') as string || '').trim()
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!name || !username || !password) {
    return { error: 'Please provide Name, Username, and Password.' }
  }

  const email = username.includes('@') ? username : `${username.toLowerCase()}@bsg.com`
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        username: username,
        role: 'agent',
      },
    },
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/superadmin/agents')
  return { success: true, user: data.user }
}
