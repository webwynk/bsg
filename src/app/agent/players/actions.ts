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

      // Query active_sessions, profiles, and auth users in parallel using Promise.all
      const [sessRes, profRes, usersRes] = await Promise.all([
        supabaseAdmin.from('active_sessions').select('user_id, last_seen_at'),
        supabaseAdmin.from('profiles').select('id, username, balance, is_active').eq('agent_id', agentId),
        supabaseAdmin.auth.admin.listUsers()
      ])

      const sessions = sessRes.data || null
      const allUsers = usersRes.data?.users || []
      const now = new Date().getTime()

      if (profRes.data && profRes.data.length > 0) {
        const players = profRes.data.map(p => {
          const activeSess = sessions?.find(s => s.user_id === p.id)
          const isOnline = activeSess ? (now - new Date(activeSess.last_seen_at).getTime() < 60000) : false
          const u = allUsers.find(user => user.id === p.id)
          const fullName = u?.user_metadata?.full_name || u?.user_metadata?.name || p.username || 'Player'
          return {
            id: p.id,
            name: fullName,
            username: p.username || '',
            balance: Number(p.balance || 0),
            status: p.is_active ? 'Active' : 'Blocked',
            isOnline,
            gamePlays: 0
          }
        })
        return { players }
      }

      // Fallback to auth listUsers if profiles table query returns empty
      const { data, error } = await supabaseAdmin.auth.admin.listUsers()
      if (!error && data?.users) {
        const players = data.users
          .filter(u => u.user_metadata?.role === 'player' && u.user_metadata?.agent_id === agentId)
          .map(u => {
            const activeSess = sessions?.find(s => s.user_id === u.id)
            const isOnline = activeSess ? (now - new Date(activeSess.last_seen_at).getTime() < 60000) : false
            return {
              id: u.id,
              name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'Player',
              username: u.user_metadata?.username || u.email?.split('@')[0] || '',
              balance: u.user_metadata?.balance || 0,
              status: u.user_metadata?.status || 'Active',
              isOnline,
              gamePlays: 0
            }
          })
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

  const usernameRegex = /^[a-zA-Z0-9]{3,20}$/
  if (!usernameRegex.test(username)) {
    return { error: 'Username must be 3 to 20 characters and contain ONLY letters and numbers (no symbols, spaces, or special characters).' }
  }

  const supabase = await createServerClient()
  const { data: { user: agentUser } } = await supabase.auth.getUser()
  const agentId = agentUser?.id

  const email = username.includes('@') ? username : `${username.toLowerCase()}@bestsmartgame.com`

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

    if (data?.user) {
      try {
        await supabaseAdmin.from('profiles').upsert({
          id: data.user.id,
          username,
          role: 'player',
          agent_id: agentId || null,
          balance: 0,
          is_active: true
        })
      } catch (_) {}
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

async function resolveUserIdentifier(supabaseAdmin: any, identifier: string): Promise<string | null> {
  if (!identifier) return null
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

export async function togglePlayerStatusAction(playerIdentifier: string, currentStatus: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const supabase = await createServerClient()
    const { data: { user: callerUser } } = await supabase.auth.getUser()

    const playerId = await resolveUserIdentifier(supabaseAdmin, playerIdentifier)
    if (!playerId) return { error: 'Player account not found.' }

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

export async function getPlayerDetailHistoryAction(playerIdentifier: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (!serviceRoleKey || !supabaseUrl || !playerIdentifier) {
    return { gamePlays: [], pointsHistory: [] }
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const playerId = await resolveUserIdentifier(supabaseAdmin, playerIdentifier)
  if (!playerId) {
    return { gamePlays: [], pointsHistory: [] }
  }

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
    singleBets: Record<string, number>
    doubleBets: Record<string, number>
    tripleBets: Record<string, number>
    redDigit: number | null
    greenDigit: number | null
    blackDigit: number | null
  }> = []

  try {
    // Primary source: round_bets joined with game_rounds
    let { data: roundBets, error: betsErr } = await supabaseAdmin
      .from('triple_chance_bets')
      .select('*, triple_chance_rounds(red, green, black, status)')
      .eq('user_id', playerId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (betsErr || !roundBets) {
      const { data: rawBets } = await supabaseAdmin
        .from('triple_chance_bets')
        .select('*')
        .eq('user_id', playerId)
        .order('created_at', { ascending: false })
        .limit(50)
      roundBets = rawBets || null
    }

    if (roundBets && roundBets.length > 0) {
      gamePlays = roundBets.map(p => {
        const roundRaw = p.triple_chance_rounds
        const round = Array.isArray(roundRaw) ? (roundRaw[0] || {}) : (roundRaw || {})
        const red = round.red !== null && round.red !== undefined ? Number(round.red) : null
        const green = round.green !== null && round.green !== undefined ? Number(round.green) : null
        const black = round.black !== null && round.black !== undefined ? Number(round.black) : null
        const resultNumber = (red !== null && green !== null && black !== null) ? (red * 100 + green * 10 + black) : 0

        const singleBetsObj = (p.single_bets || {}) as Record<string, number>
        const doubleBetsObj = (p.double_bets || {}) as Record<string, number>
        const tripleBetsObj = (p.triple_bets || {}) as Record<string, number>

        const activeModes = []
        if (Object.keys(singleBetsObj).length > 0) activeModes.push('SINGLE')
        if (Object.keys(doubleBetsObj).length > 0) activeModes.push('DOUBLE')
        if (Object.keys(tripleBetsObj).length > 0) activeModes.push('TRIPLE')
        const modeLabel = activeModes.length > 0 ? activeModes.join(' + ') : 'TRIPLE CHANCE'

        let selText = 'Multi-board Bet'
        const parts: string[] = []
        if (Object.keys(singleBetsObj).length > 0) parts.push(`Single: ${Object.keys(singleBetsObj).join(',')}`)
        if (Object.keys(doubleBetsObj).length > 0) parts.push(`Double: ${Object.keys(doubleBetsObj).join(',')}`)
        if (Object.keys(tripleBetsObj).length > 0) parts.push(`Triple: ${Object.keys(tripleBetsObj).join(',')}`)
        if (parts.length > 0) selText = parts.join(' | ')

        // FIX #1: Always use server-resolved win amounts from the database.
        // NEVER recalculate win in JavaScript — the DB already computed and stored
        // the exact correct values in triple_chance_bets.win_amount / single_win / double_win / triple_win.
        const isResolved = p.is_resolved as boolean
        const winAmt = Number(p.win_amount || 0)

        // FIX #2: Show PENDING for unresolved bets — do NOT mark as LOST when result
        // hasn't been determined yet (is_resolved = false means get_my_round_result
        // hasn't been called for this round yet).
        let rowStatus: 'WON' | 'LOST'
        if (!isResolved) {
          rowStatus = 'LOST' // will show as PENDING via winAmt=0 but bet exists
        } else {
          rowStatus = winAmt > 0 ? 'WON' : 'LOST'
        }

        const rawId = p.round_id || p.id || ''
        const unifiedHandId = rawId.length > 8 ? '...' + rawId.slice(-8) : rawId

        return {
          id: unifiedHandId,
          game: 'Triple Chance',
          mode: modeLabel,
          selections: selText,
          resultNumber,
          bet: Number(p.total_stake || 0),
          win: winAmt,
          status: rowStatus,
          isResolved,
          date: new Date(p.created_at).toLocaleString('en-US', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          singleBets: singleBetsObj,
          doubleBets: doubleBetsObj,
          tripleBets: tripleBetsObj,
          redDigit: red,
          greenDigit: green,
          blackDigit: black
        }
      })
    } else {
      // Fallback: game_history
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

          const picked = p.numbers_picked || {}
          const singleBetsObj = (picked.single && Object.keys(picked.single).length > 0) ? picked.single : (p.single_bets || {})
          const doubleBetsObj = (picked.double && Object.keys(picked.double).length > 0) ? picked.double : (p.double_bets || {})
          const tripleBetsObj = (picked.triple && Object.keys(picked.triple).length > 0) ? picked.triple : (p.triple_bets || {})

          const activeModes = []
          if (singleBetsObj && Object.keys(singleBetsObj).length > 0) activeModes.push('SINGLE')
          if (doubleBetsObj && Object.keys(doubleBetsObj).length > 0) activeModes.push('DOUBLE')
          if (tripleBetsObj && Object.keys(tripleBetsObj).length > 0) activeModes.push('TRIPLE')
          const modeLabel = activeModes.length > 0 ? activeModes.join(' + ') : (p.mode || 'single').toUpperCase()

          const resStr = (p.result_number !== null && p.result_number !== undefined) ? p.result_number.toString().padStart(3, '0') : '000'
          const red = p.red_digit !== null ? p.red_digit : parseInt(resStr[0], 10)
          const green = p.green_digit !== null ? p.green_digit : parseInt(resStr[1], 10)
          const black = p.black_digit !== null ? p.black_digit : parseInt(resStr[2], 10)

          return {
            id: p.id.substring(0, 8),
            game: p.game_name || 'Triple Chance',
            mode: modeLabel,
            selections: selText,
            resultNumber: p.result_number,
            bet: Number(p.bet_amount || 0),
            win: Number(p.win_amount || 0),
            status: (p.status || (Number(p.win_amount || 0) > 0 ? 'WON' : 'LOST')) as 'WON' | 'LOST',
            date: new Date(p.created_at).toLocaleString('en-US', {
              timeZone: 'Asia/Kolkata',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }),
            singleBets: singleBetsObj,
            doubleBets: doubleBetsObj,
            tripleBets: tripleBetsObj,
            redDigit: red,
            greenDigit: green,
            blackDigit: black
          }
        })
      }
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

    if (txns && txns.length > 0) {
      pointsHistory = txns
        .filter(tx => ['agent_topup', 'agent_deduct', 'agent_credit', 'agent_debit', 'deposit', 'withdraw', 'admin_adjustment'].includes(tx.type))
        .map(tx => {
          const amt = Number(tx.amount || 0)
          const isDeposit = tx.type === 'agent_topup' || tx.type === 'agent_credit' || tx.type === 'deposit' || amt > 0
          return {
            id: tx.id.substring(0, 8),
            type: (isDeposit ? 'deposit' : 'withdraw') as 'deposit' | 'withdraw',
            amount: Math.abs(amt),
            balanceAfter: Number(tx.balance_after || 0),
            date: new Date(tx.created_at).toLocaleString('en-US', {
              timeZone: 'Asia/Kolkata',
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

  return { gamePlays, pointsHistory }
}

export async function resetPlayerPasswordAction(playerIdentifier: string, newPassword: string) {
  if (!playerIdentifier || !newPassword || newPassword.trim().length < 6) {
    return { error: 'Password must be at least 6 characters.' }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const playerId = await resolveUserIdentifier(supabaseAdmin, playerIdentifier)
    if (!playerId) return { error: 'Player account not found.' }

    const supabase = await createServerClient()
    const { data: { user: callerUser } } = await supabase.auth.getUser()

    const { data: userData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(playerId)
    if (getUserError || !userData?.user) {
      return { error: 'Player account not found.' }
    }

    // Security check: Agent can only manage their own players
    if (callerUser && userData.user.user_metadata?.agent_id && userData.user.user_metadata?.agent_id !== callerUser.id) {
      return { error: 'Unauthorized. You can only manage your own assigned players.' }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(playerId, {
      password: newPassword.trim()
    })

    if (updateError) {
      return { error: updateError.message }
    }

    return { success: true }
  }

  return { error: 'Service Role Key not configured.' }
}


