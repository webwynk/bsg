'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

export async function getPlayersAction() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const agentId = user?.id

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data, error } = await supabaseAdmin.auth.admin.listUsers()
      if (!error && data?.users) {
        const players = data.users
          .filter(u => u.user_metadata?.role === 'player' && (!agentId || !u.user_metadata?.agent_id || u.user_metadata?.agent_id === agentId))
          .map(u => ({
            id: u.id,
            name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'Player',
            username: u.user_metadata?.username || u.email?.split('@')[0] || '',
            balance: u.user_metadata?.balance || 0,
            status: u.user_metadata?.status || 'Active',
            gamePlays: 0
          }))
        return { players }
      }
    } catch (_) {}
  }

  return { players: [] }
}

export async function createPlayerAction(formData: FormData) {
  const name = (formData.get('name') as string || '').trim()
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!name || !username || !password) {
    return { error: 'Please provide Name, Username, and Password.' }
  }

  const supabase = await createServerClient()
  const { data: { user: agentUser } } = await supabase.auth.getUser()
  const agentId = agentUser?.id

  const email = username.includes('@') ? username : `${username.toLowerCase()}@bsg.com`

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceRoleKey) {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        username,
        role: 'player',
        agent_id: agentId || null,
        balance: 0,
        status: 'Active',
      },
    })

    if (error) {
      return { error: error.message }
    }

    revalidatePath('/agent/players')
    revalidatePath('/agent')
    revalidatePath('/superadmin/agents')
    return { success: true, user: data.user }
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        username,
        role: 'player',
        agent_id: agentId || null,
        balance: 0,
        status: 'Active',
      },
    },
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/agent/players')
  revalidatePath('/agent')
  revalidatePath('/superadmin/agents')
  return { success: true, user: data.user }
}

export async function togglePlayerStatusAction(playerId: string, currentStatus: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const newStatus = currentStatus === 'Active' ? 'Blocked' : 'Active'
    const { data: userData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(playerId)
    if (getUserError || !userData?.user) {
      return { error: 'Player account not found.' }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(playerId, {
      user_metadata: {
        ...userData.user.user_metadata,
        status: newStatus
      }
    })

    if (updateError) {
      return { error: updateError.message }
    }

    revalidatePath('/agent/players')
    return { success: true, newStatus }
  }

  return { error: 'Service Role Key not configured.' }
}
