'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { logAuditEventAction } from '../actions'

export async function getAgentsAction() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data, error } = await supabaseAdmin.auth.admin.listUsers()
      if (!error && data?.users) {
        const agents = data.users
          .filter(u => u.user_metadata?.role === 'agent' || (u.email && u.email.endsWith('@bsg.com') && !u.email.startsWith('admin')))
          .map(u => ({
            id: u.id,
            name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'Agent',
            username: u.user_metadata?.username || u.email?.split('@')[0] || '',
            balance: u.user_metadata?.balance || 0,
            status: u.user_metadata?.status || 'Active'
          }))
        return { agents }
      }
    } catch (_) {}
  }

  return { agents: [] }
}

export async function getAgentDetailAction(agentId: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data: userData, error } = await supabaseAdmin.auth.admin.getUserById(agentId)
      if (!error && userData?.user) {
        const u = userData.user
        return {
          agent: {
            id: u.id,
            name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'Agent',
            username: u.user_metadata?.username || u.email?.split('@')[0] || '',
            balance: u.user_metadata?.balance || 0,
            status: u.user_metadata?.status || 'Active'
          }
        }
      }
    } catch (_) {}
  }

  return { error: 'Agent not found' }
}

export async function createAgentAction(formData: FormData) {
  const name = (formData.get('name') as string || '').trim()
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!name || !username || !password) {
    return { error: 'Please provide Name, Username, and Password.' }
  }

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
        role: 'agent',
        balance: 0,
        status: 'Active',
      },
    })

    if (error) {
      return { error: error.message }
    }

    await logAuditEventAction('System', `Created new Agent account @${username}`)
    revalidatePath('/superadmin/agents')
    return { success: true, user: data.user }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        username,
        role: 'agent',
        balance: 0,
        status: 'Active',
      },
    },
  })

  if (error) {
    return { error: error.message }
  }

  await logAuditEventAction('System', `Created new Agent account @${username}`)
  revalidatePath('/superadmin/agents')
  return { success: true, user: data.user }
}

export async function transferPointsAction(targetId: string, amount: number, type: 'deposit' | 'withdraw') {
  if (!targetId || !amount || amount <= 0) {
    return { error: 'Please enter a valid non-zero amount.' }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: userData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(targetId)
    if (getUserError || !userData?.user) {
      return { error: 'Target account not found.' }
    }

    const currentBalance = userData.user.user_metadata?.balance || 0
    if (type === 'withdraw' && currentBalance < amount) {
      return { error: `Insufficient balance. Current balance is ${currentBalance} Coins` }
    }

    const delta = type === 'deposit' ? amount : -amount
    const newBalance = Math.max(0, currentBalance + delta)
    const targetUsername = userData.user.user_metadata?.username || userData.user.email?.split('@')[0] || 'account'

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
      user_metadata: {
        ...userData.user.user_metadata,
        balance: newBalance
      }
    })

    if (updateError) {
      return { error: updateError.message }
    }

    await logAuditEventAction('Transaction', `${type === 'deposit' ? 'Deposited' : 'Withdrew'} ${amount.toLocaleString()} Coins for @${targetUsername}`)
    revalidatePath('/superadmin/agents')
    revalidatePath(`/superadmin/agents/${targetId}`)
    revalidatePath('/agent/players')
    return { success: true, newBalance }
  }

  return { error: 'Service Role Key not configured in Vercel environment variables.' }
}
