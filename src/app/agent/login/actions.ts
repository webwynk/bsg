'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function agentLogin(formData: FormData) {
  const username = formData.get('username')
  const password = formData.get('password')

  if (username === 'agent' && password === 'agent') {
    const cookieStore = await cookies()
    cookieStore.set('mock_session', 'agent', { path: '/' })
    redirect('/agent')
  }

  redirect('/agent/login?error=Invalid credentials. Use agent / agent')
}
