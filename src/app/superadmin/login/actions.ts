'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function superAdminLogin(formData: FormData) {
  const username = formData.get('username')
  const password = formData.get('password')

  if (username === 'admin' && password === 'admin') {
    const cookieStore = await cookies()
    cookieStore.set('mock_session', 'superadmin', { path: '/' })
    redirect('/superadmin')
  }

  redirect('/superadmin/login?error=Invalid credentials. Use admin / admin')
}
