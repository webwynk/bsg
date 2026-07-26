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
          .filter(u => u.user_metadata?.role === 'player' && u.user_metadata?.agent_id === agentId)
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
      if (error.message.toLowerCase().includes('already') || error.message.toLowerCase().includes('exists')) {
        return { error: `Username "${username}" is already taken by another player. Please choose a different username.` }
      }
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

    const supabase = await createServerClient()
    const { data: { user: callerUser } } = await supabase.auth.getUser()

    const newStatus = currentStatus === 'Active' ? 'Blocked' : 'Active'
    const { data: userData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(playerId)
    if (getUserError || !userData?.user) {
      return { error: 'Player account not found.' }
    }

    // Security check: Agent can only manage their own players
    if (callerUser && userData.user.user_metadata?.agent_id && userData.user.user_metadata?.agent_id !== callerUser.id) {
      return { error: 'Unauthorized. You can only manage your own assigned players.' }
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

export async function getPlayerDetailHistoryAction(playerId: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (!serviceRoleKey || !supabaseUrl || !playerId) {
    return { gamePlays: [], pointsHistory: [] }
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 1. Fetch game plays from public.game_history
  let gamePlays: Array<{
    id: string
    game: string
    mode: string
    selections: string
    resultNumber: number
    bet: number
    win: number
    status: 'WON' | 'LOST'
    date: string
  }> = []

  try {
    const { data: plays } = await supabaseAdmin
      .from('game_history')
      .select('*')
      .eq('user_id', playerId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (plays) {
      gamePlays = plays.map(p => {
        let selText = 'No selection'
        if (p.numbers_picked && typeof p.numbers_picked === 'object') {
          const modeObj = p.numbers_picked[p.mode] || p.numbers_picked
          if (typeof modeObj === 'object') {
            const parts = Object.entries(modeObj).map(([num, val]) => `${(p.mode || 'single').toUpperCase()}: ${num} (${val} Coins)`)
            if (parts.length > 0) selText = parts.join(', ')
          }
        }

        return {
          id: p.id.substring(0, 8),
          game: p.game_name || 'Triple Chance',
          mode: (p.mode || 'single').toUpperCase(),
          selections: selText,
          resultNumber: p.result_number,
          bet: Number(p.bet_amount || 0),
          win: Number(p.win_amount || 0),
          status: (p.status || (Number(p.win_amount || 0) > 0 ? 'WON' : 'LOST')) as 'WON' | 'LOST',
          date: new Date(p.created_at).toLocaleString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        }
      })
    }
  } catch (_) {}

  // 2. Fetch cashier points history from public.transactions
  let pointsHistory: Array<{
    id: string
    type: 'deposit' | 'withdraw'
    amount: number
    balanceAfter: number
    date: string
  }> = []

  try {
    const { data: txns } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', playerId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (txns) {
      pointsHistory = txns.map(tx => ({
        id: tx.id.substring(0, 8),
        type: tx.type === 'agent_credit' ? 'deposit' : 'withdraw',
        amount: Math.abs(Number(tx.amount || 0)),
        balanceAfter: Number(tx.balance_after || 0),
        date: new Date(tx.created_at).toLocaleString([], {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      }))
    }
  } catch (_) {}

  return { gamePlays, pointsHistory }
}
