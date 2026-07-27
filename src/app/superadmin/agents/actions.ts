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

      const { data: profiles, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('id, username, balance, is_active')
        .eq('role', 'agent')

      if (!profErr && profiles) {
        const agents = profiles.map(p => ({
          id: p.id,
          name: p.username || 'Agent',
          username: p.username || '',
          balance: Number(p.balance || 0),
          status: p.is_active ? 'Active' : 'Blocked'
        }))
        return { agents }
      }

      // Fallback to Auth listUsers if profiles table is empty
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

async function resolveUserIdentifier(supabaseAdmin: any, identifier: string): Promise<string | null> {
  if (!identifier || identifier === 'all') return identifier
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)
  if (isUuid) return identifier

  try {
    const { data: lookup } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('username', identifier)
      .single()
    if (lookup?.id) return lookup.id
  } catch (_) {}

  try {
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
    const matched = (usersData?.users || []).find((u: any) =>
      u.user_metadata?.username?.toLowerCase() === identifier.toLowerCase() ||
      u.email?.toLowerCase().split('@')[0] === identifier.toLowerCase()
    )
    if (matched?.id) return matched.id
  } catch (_) {}

  return null
}

export async function getAgentDetailAction(agentIdentifier: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      // Step 1: Resolve username → UUID (case-insensitive + auth listUsers fallback)
      const agentId = await resolveUserIdentifier(supabaseAdmin, agentIdentifier)
      if (!agentId) {
        return { agent: null, players: [], resolvedAgentId: null, error: 'Agent not found' }
      }

      // Step 2: Run sub-queries in parallel
      const [agentProfileRes, sessRes, playersRes] = await Promise.all([
        supabaseAdmin.from('profiles').select('id, username, balance, is_active').eq('id', agentId).single(),
        supabaseAdmin.from('active_sessions').select('user_id, last_seen_at'),
        supabaseAdmin.from('profiles').select('id, username, balance, is_active').eq('agent_id', agentId)
      ])

      const sessions = sessRes.data || null
      const now = new Date().getTime()

      // Extract agent info (profiles primary -> Auth fallback)
      let ap = agentProfileRes.data
      if (!ap) {
        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(agentId)
        if (userData?.user) {
          const u = userData.user
          ap = {
            id: u.id,
            username: u.user_metadata?.username || u.user_metadata?.full_name || u.email?.split('@')[0] || 'Agent',
            balance: Number(u.user_metadata?.balance || 0),
            is_active: u.user_metadata?.status !== 'Blocked'
          }
          // Self-heal profiles table
          try {
            await supabaseAdmin.from('profiles').upsert({
              id: u.id,
              username: ap.username,
              role: 'agent',
              balance: ap.balance,
              is_active: ap.is_active
            })
          } catch (_) {}
        }
      }

      if (!ap) {
        return { agent: null, players: [], resolvedAgentId: null, error: 'Agent profile not found' }
      }

      // Extract players (profiles primary -> Auth fallback)
      let agentPlayers: Array<any> = []
      if (playersRes.data && playersRes.data.length > 0) {
        agentPlayers = playersRes.data.map(p => {
          const activeSess = sessions?.find(s => s.user_id === p.id)
          const isOnline = activeSess ? (now - new Date(activeSess.last_seen_at).getTime() < 60000) : false
          return {
            id: p.id,
            name: p.username || 'Player',
            username: p.username || '',
            balance: Number(p.balance || 0),
            status: p.is_active ? 'Active' : 'Blocked',
            isOnline,
            gamePlays: 0
          }
        })
      } else {
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
        agentPlayers = (usersData?.users || [])
          .filter(p => p.user_metadata?.role === 'player' && (p.user_metadata?.agent_id === agentId || !p.user_metadata?.agent_id))
          .map(p => {
            const activeSess = sessions?.find(s => s.user_id === p.id)
            const isOnline = activeSess ? (now - new Date(activeSess.last_seen_at).getTime() < 60000) : false
            return {
              id: p.id,
              name: p.user_metadata?.full_name || p.email?.split('@')[0] || 'Player',
              username: p.user_metadata?.username || p.email?.split('@')[0] || '',
              balance: Number(p.user_metadata?.balance || 0),
              status: p.user_metadata?.status || 'Active',
              isOnline,
              gamePlays: 0
            }
          })
      }

      return {
        agent: {
          id: ap.id,
          name: ap.username || 'Agent',
          username: ap.username || '',
          balance: Number(ap.balance || 0),
          status: ap.is_active ? 'Active' : 'Blocked'
        },
        players: agentPlayers,
        resolvedAgentId: agentId
      }
    } catch (_) {}
  }

  return { agent: null, players: [], resolvedAgentId: null, error: 'Service error' }
}

export async function createAgentAction(formData: FormData) {
  const name = (formData.get('name') as string || '').trim()
  const username = (formData.get('username') as string || '').trim()
  const password = (formData.get('password') as string || '').trim()

  if (!name || !username || !password) {
    return { error: 'Please provide Name, Username, and Password.' }
  }

  const usernameRegex = /^[a-zA-Z0-9]{3,20}$/
  if (!usernameRegex.test(username)) {
    return { error: 'Username must be 3 to 20 characters and contain ONLY letters and numbers (no symbols, spaces, or special characters).' }
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

    if (data.user) {
      try {
        await supabaseAdmin.from('profiles').upsert({
          id: data.user.id,
          username,
          role: 'agent',
          balance: 0,
          is_active: true
        })
      } catch (_) {}
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

export async function transferPointsAction(targetIdentifier: string, amount: number, type: 'deposit' | 'withdraw') {
  const sanitizedAmount = Math.round((amount || 0) * 100) / 100

  if (!targetIdentifier || isNaN(sanitizedAmount) || sanitizedAmount <= 0) {
    return { error: 'Please enter a valid positive amount.' }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const targetId = await resolveUserIdentifier(supabaseAdmin, targetIdentifier)
    if (!targetId) {
      return { error: 'Target account not found.' }
    }

    const { data: targetProfile, error: getTargetError } = await supabaseAdmin
      .from('profiles')
      .select('id, username, role, agent_id, balance')
      .eq('id', targetId)
      .single()

    if (getTargetError || !targetProfile) {
      return { error: 'Target profile not found in database.' }
    }

    // Get active caller user
    const supabase = await createServerClient()
    const { data: { user: callerUserAuth } } = await supabase.auth.getUser()
    
    let callerUser = callerUserAuth
    if (callerUserAuth) {
      const { data: freshCaller } = await supabaseAdmin.auth.admin.getUserById(callerUserAuth.id)
      if (freshCaller?.user) callerUser = freshCaller.user
    }

    // Case 1: Agent transferring to a Player (or Superadmin transferring to Player on behalf of Agent)
    if (targetProfile.role === 'player') {
      const callerRole = callerUser?.user_metadata?.role

      // Security check: Agent can ONLY manage their assigned players!
      if (callerRole === 'agent' && targetProfile.agent_id && targetProfile.agent_id !== callerUser?.id) {
        return { error: 'Unauthorized. You can only transfer coins to your own assigned players.' }
      }

      let agentId = targetProfile.agent_id || callerUser?.id

      if (!agentId) {
        return { error: 'Agent account for player not specified.' }
      }

      const rpcName = type === 'deposit' ? 'transfer_coins_agent_to_player' : 'withdraw_coins_player_to_agent'
      let { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc(rpcName, {
        p_agent_id: agentId,
        p_player_id: targetId,
        p_amount: sanitizedAmount
      })

      // Fallback for PostgREST schema cache parameter ordering
      if (rpcErr && rpcErr.message.includes('schema cache')) {
        const fallbackRes = await supabaseAdmin.rpc(rpcName, {
          p_agent_id: agentId,
          p_amount: sanitizedAmount,
          p_player_id: targetId
        })
        if (!fallbackRes.error) {
          rpcRes = fallbackRes.data
          rpcErr = null
        }
      }

      if (rpcErr) {
        return { error: rpcErr.message }
      }

      await logAuditEventAction('Transaction', `Agent cashier ${type === 'deposit' ? 'deposited' : 'withdrew'} ${sanitizedAmount.toLocaleString()} Coins for Player @${targetProfile.username}`)
      revalidatePath('/agent')
      revalidatePath('/agent/players')
      revalidatePath('/agent/history')
      revalidatePath('/superadmin/agents')
      return { 
        success: true, 
        newBalance: rpcRes?.new_player_balance, 
        agentBalance: rpcRes?.new_agent_balance 
      }
    }

    // Case 2: SuperAdmin transferring to an Agent directly (issue_agent_coins)
    if (targetProfile.role === 'agent') {
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('issue_agent_coins', {
        p_admin_id: callerUser?.id || null,
        p_agent_id: targetId,
        p_amount: sanitizedAmount,
        p_type: type
      })

      if (rpcErr) {
        return { error: rpcErr.message }
      }

      await logAuditEventAction('Transaction', `SuperAdmin ${type === 'deposit' ? 'deposited' : 'withdrew'} ${sanitizedAmount.toLocaleString()} Coins for Agent @${targetProfile.username}`)
      revalidatePath('/superadmin/agents')
      revalidatePath('/superadmin/agents/issued')
      return { success: true, newBalance: rpcRes?.new_balance }
    }

    return { error: 'Invalid target role for transfer.' }
  }

  return { error: 'Service Role Key not configured in Vercel environment variables.' }
}

export async function getAgentCoinTransactionsAction(params?: {
  agentId?: string
  startDate?: string
  endDate?: string
  type?: 'deposit' | 'withdraw' | 'all'
  page?: number
  limit?: number
}) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (!serviceRoleKey || !supabaseUrl) {
    return { transactions: [], totalItems: 0, totalPages: 1, summary: { totalDeposited: 0, totalWithdrawn: 0, netIssued: 0 } }
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  let query = supabaseAdmin
    .from('agent_coin_transactions')
    .select('*', { count: 'exact' })

  if (params?.agentId && params.agentId !== 'all') {
    const resolvedAgentId = await resolveUserIdentifier(supabaseAdmin, params.agentId)
    if (resolvedAgentId) {
      query = query.eq('agent_id', resolvedAgentId)
    }
  }

  if (params?.type && params.type !== 'all') {
    query = query.eq('type', params.type)
  }

  if (params?.startDate) {
    const startIso = new Date(params.startDate).toISOString()
    query = query.gte('created_at', startIso)
  }

  if (params?.endDate) {
    const endDateObj = new Date(params.endDate)
    endDateObj.setHours(23, 59, 59, 999)
    query = query.lte('created_at', endDateObj.toISOString())
  }

  const page = params?.page || 1
  const limit = params?.limit || 10
  const from = (page - 1) * limit
  const to = from + limit - 1

  query = query.order('created_at', { ascending: false }).range(from, to)

  const { data, count, error } = await query

  if (error) {
    return { transactions: [], totalItems: 0, totalPages: 1, summary: { totalDeposited: 0, totalWithdrawn: 0, netIssued: 0 } }
  }

  // Query summary totals for full filtered dataset
  let summaryQuery = supabaseAdmin
    .from('agent_coin_transactions')
    .select('type, amount')

  if (params?.agentId && params.agentId !== 'all') {
    summaryQuery = summaryQuery.eq('agent_id', params.agentId)
  }
  if (params?.startDate) {
    const startIso = new Date(params.startDate).toISOString()
    summaryQuery = summaryQuery.gte('created_at', startIso)
  }
  if (params?.endDate) {
    const endDateObj = new Date(params.endDate)
    endDateObj.setHours(23, 59, 59, 999)
    summaryQuery = summaryQuery.lte('created_at', endDateObj.toISOString())
  }

  const { data: summaryData } = await summaryQuery

  let totalDeposited = 0
  let totalWithdrawn = 0
  if (summaryData) {
    summaryData.forEach(item => {
      if (item.type === 'deposit') totalDeposited += Number(item.amount)
      if (item.type === 'withdraw') totalWithdrawn += Number(item.amount)
    })
  }

  const transactions = (data || []).map(tx => ({
    id: tx.id,
    agentId: tx.agent_id,
    agentName: tx.agent_name,
    agentUsername: tx.agent_username,
    type: tx.type,
    amount: Number(tx.amount),
    createdAt: tx.created_at,
    date: new Date(tx.created_at).toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }))

  const totalItems = count || 0
  const totalPages = Math.ceil(totalItems / limit) || 1

  return {
    transactions,
    totalItems,
    totalPages,
    summary: {
      totalDeposited,
      totalWithdrawn,
      netIssued: totalDeposited - totalWithdrawn
    }
  }
}

export async function toggleAgentStatusAction(agentIdentifier: string, currentStatus: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const agentId = await resolveUserIdentifier(supabaseAdmin, agentIdentifier)
    if (!agentId) return { error: 'Agent not found.' }

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

export async function updateAgentPasswordAction(agentIdentifier: string, newPassword: string) {
  if (!newPassword || newPassword.length < 6) {
    return { error: 'Password must be at least 6 characters.' }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const agentId = await resolveUserIdentifier(supabaseAdmin, agentIdentifier)
    if (!agentId) return { error: 'Agent not found.' }

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
    return { success: true }
  }

  return { error: 'Service Role Key not configured.' }
}
