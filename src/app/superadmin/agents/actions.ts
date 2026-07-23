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
          .filter(u => u.user_metadata?.role === 'agent')
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
        
        // Fetch all players belonging to this agent
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
        const agentPlayers = (usersData?.users || [])
          .filter(p => p.user_metadata?.role === 'player' && p.user_metadata?.agent_id === agentId)
          .map(p => ({
            id: p.id,
            name: p.user_metadata?.full_name || p.email?.split('@')[0] || 'Player',
            username: p.user_metadata?.username || p.email?.split('@')[0] || '',
            balance: p.user_metadata?.balance || 0,
            status: p.user_metadata?.status || 'Active',
            gamePlays: 0
          }))

        return {
          agent: {
            id: u.id,
            name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'Agent',
            username: u.user_metadata?.username || u.email?.split('@')[0] || '',
            balance: u.user_metadata?.balance || 0,
            status: u.user_metadata?.status || 'Active'
          },
          players: agentPlayers
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
  const sanitizedAmount = Math.round((amount || 0) * 100) / 100

  if (!targetId || isNaN(sanitizedAmount) || sanitizedAmount <= 0) {
    return { error: 'Please enter a valid positive amount.' }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: targetUserData, error: getTargetError } = await supabaseAdmin.auth.admin.getUserById(targetId)
    if (getTargetError || !targetUserData?.user) {
      return { error: 'Target account not found.' }
    }

    const targetUser = targetUserData.user
    const targetRole = targetUser.user_metadata?.role
    const targetBalance = targetUser.user_metadata?.balance || 0
    const targetUsername = targetUser.user_metadata?.username || targetUser.email?.split('@')[0] || 'account'

    // Get active caller user
    const supabase = await createServerClient()
    const { data: { user: callerUserAuth } } = await supabase.auth.getUser()
    
    let callerUser = callerUserAuth
    if (callerUserAuth) {
      const { data: freshCaller } = await supabaseAdmin.auth.admin.getUserById(callerUserAuth.id)
      if (freshCaller?.user) callerUser = freshCaller.user
    }

    // Case 1: Agent transferring to a Player
    if (targetRole === 'player') {
      const agentId = targetUser.user_metadata?.agent_id || callerUser?.id
      if (!agentId) {
        return { error: 'Agent session not found.' }
      }

      const { data: agentUserData } = await supabaseAdmin.auth.admin.getUserById(agentId)
      if (!agentUserData?.user) {
        return { error: 'Agent account not found.' }
      }

      const agentUser = agentUserData.user
      const agentBalance = agentUser.user_metadata?.balance || 0
      const agentUsername = agentUser.user_metadata?.username || agentUser.email?.split('@')[0] || 'agent'

      if (type === 'deposit') {
        // STRICT OVERDRAFT CHECK: Agent cannot deposit more than available balance!
        if (agentBalance < sanitizedAmount) {
          return { 
            error: `Insufficient Agent Coins. You only have ${agentBalance.toLocaleString()} Coins available, but tried to deposit ${sanitizedAmount.toLocaleString()} Coins.` 
          }
        }

        const newAgentBalance = Math.max(0, agentBalance - sanitizedAmount)
        const newPlayerBalance = targetBalance + sanitizedAmount

        await supabaseAdmin.auth.admin.updateUserById(agentId, {
          user_metadata: { ...agentUser.user_metadata, balance: newAgentBalance }
        })

        await supabaseAdmin.auth.admin.updateUserById(targetId, {
          user_metadata: { ...targetUser.user_metadata, balance: newPlayerBalance }
        })

        await logAuditEventAction('Transaction', `Agent @${agentUsername} deposited ${sanitizedAmount.toLocaleString()} Coins to Player @${targetUsername}`)
        revalidatePath('/agent')
        revalidatePath('/agent/players')
        revalidatePath('/superadmin/agents')
        revalidatePath(`/superadmin/agents/${agentId}`)
        return { success: true, newBalance: newPlayerBalance, agentBalance: newAgentBalance }
      } else {
        // STRICT OVERDRAFT CHECK: Agent cannot withdraw more than player's available balance!
        if (targetBalance < sanitizedAmount) {
          return { 
            error: `Insufficient Player Coins. Player @${targetUsername} only has ${targetBalance.toLocaleString()} Coins, but tried to withdraw ${sanitizedAmount.toLocaleString()} Coins.` 
          }
        }

        const newPlayerBalance = Math.max(0, targetBalance - sanitizedAmount)
        const newAgentBalance = agentBalance + sanitizedAmount

        await supabaseAdmin.auth.admin.updateUserById(targetId, {
          user_metadata: { ...targetUser.user_metadata, balance: newPlayerBalance }
        })

        await supabaseAdmin.auth.admin.updateUserById(agentId, {
          user_metadata: { ...agentUser.user_metadata, balance: newAgentBalance }
        })

        await logAuditEventAction('Transaction', `Agent @${agentUsername} withdrew ${sanitizedAmount.toLocaleString()} Coins from Player @${targetUsername}`)
        revalidatePath('/agent')
        revalidatePath('/agent/players')
        revalidatePath('/superadmin/agents')
        revalidatePath(`/superadmin/agents/${agentId}`)
        return { success: true, newBalance: newPlayerBalance, agentBalance: newAgentBalance }
      }
    }

    // Case 2: SuperAdmin transferring to an Agent directly
    if (type === 'withdraw' && targetBalance < sanitizedAmount) {
      return { 
        error: `Insufficient Agent Coins. Agent @${targetUsername} only has ${targetBalance.toLocaleString()} Coins, but tried to withdraw ${sanitizedAmount.toLocaleString()} Coins.` 
      }
    }

    const delta = type === 'deposit' ? sanitizedAmount : -sanitizedAmount
    const newBalance = Math.max(0, targetBalance + delta)

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
      user_metadata: {
        ...targetUser.user_metadata,
        balance: newBalance
      }
    })

    if (updateError) {
      return { error: updateError.message }
    }

    await logAuditEventAction('Transaction', `SuperAdmin ${type === 'deposit' ? 'deposited' : 'withdrew'} ${sanitizedAmount.toLocaleString()} Coins for Agent @${targetUsername}`)
    revalidatePath('/superadmin/agents')
    revalidatePath(`/superadmin/agents/${targetId}`)
    return { success: true, newBalance }
  }

  return { error: 'Service Role Key not configured in Vercel environment variables.' }
}

export async function toggleAgentStatusAction(agentId: string, currentStatus: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const newStatus = currentStatus === 'Active' ? 'Blocked' : 'Active'
    
    // 1. Update Agent status
    const { data: agentUserData, error: getAgentError } = await supabaseAdmin.auth.admin.getUserById(agentId)
    if (getAgentError || !agentUserData?.user) {
      return { error: 'Agent account not found.' }
    }

    const agentUsername = agentUserData.user.user_metadata?.username || agentUserData.user.email?.split('@')[0] || 'agent'

    const { error: updateAgentError } = await supabaseAdmin.auth.admin.updateUserById(agentId, {
      user_metadata: {
        ...agentUserData.user.user_metadata,
        status: newStatus
      }
    })

    if (updateAgentError) {
      return { error: updateAgentError.message }
    }

    // 2. Cascading Block/Unblock for all players under this Agent
    let blockedPlayersCount = 0
    if (newStatus === 'Blocked') {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      if (usersData?.users) {
        const agentPlayers = usersData.users.filter(u => u.user_metadata?.role === 'player' && u.user_metadata?.agent_id === agentId)
        for (const player of agentPlayers) {
          await supabaseAdmin.auth.admin.updateUserById(player.id, {
            user_metadata: {
              ...player.user_metadata,
              status: 'Blocked'
            }
          })
          blockedPlayersCount++
        }
      }
    }

    const logDetail = newStatus === 'Blocked' 
      ? `Blocked Agent @${agentUsername} and cascading blocked ${blockedPlayersCount} player accounts`
      : `Unblocked Agent @${agentUsername}`
    
    await logAuditEventAction('Security', logDetail)
    revalidatePath('/superadmin/agents')
    revalidatePath(`/superadmin/agents/${agentId}`)
    return { success: true, newStatus, blockedPlayersCount }
  }

  return { error: 'Service Role Key not configured.' }
}

export async function updateAgentPasswordAction(agentId: string, newPassword: string) {
  if (!newPassword || newPassword.length < 6) {
    return { error: 'Password must be at least 6 characters.' }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: agentUserData } = await supabaseAdmin.auth.admin.getUserById(agentId)
    const agentUsername = agentUserData?.user?.user_metadata?.username || 'agent'

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(agentId, {
      password: newPassword
    })

    if (updateError) {
      return { error: updateError.message }
    }

    await logAuditEventAction('Security', `Updated password for Agent @${agentUsername}`)
    revalidatePath('/superadmin/agents')
    revalidatePath(`/superadmin/agents/${agentId}`)
    return { success: true }
  }

  return { error: 'Service Role Key not configured.' }
}
