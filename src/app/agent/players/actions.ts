'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { isCreditTxn } from '@/lib/ledger'

export async function getPlayersAction(targetAgentId?: string) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const agentId = targetAgentId || user?.id

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
              balance: 0, // always 0 in fallback — profiles table is authoritative for live balance
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

    // Sync profiles.is_active so dashboard reads correct status from profiles table
    await supabaseAdmin.from('profiles').update({
      is_active: newStatus === 'Active'
    }).eq('id', playerId)

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

  // 1. Fetch game plays from triple_chance_bets using TWO-STEP query
  // WHY TWO-STEP: PostgREST relational joins do NOT bypass RLS on the joined table even when
  // using service role key. The join strips triple_chance_rounds rows silently because
  // triple_chance_rounds has RLS enabled and no user auth context is set on supabaseAdmin.
  // Solution: fetch bets directly (service role bypasses RLS on direct queries),
  // then fetch the relevant rounds directly, then merge in JS.
  let gamePlays: Array<{
    id: string
    game: string
    mode: string
    selections: string
    resultNumber: number
    bet: number
    win: number
    status: 'WON' | 'LOST'
    isResolved: boolean
    date: string
    createdAtIso: string
    singleBets: Record<string, number>
    doubleBets: Record<string, number>
    tripleBets: Record<string, number>
    redDigit: number | null
    greenDigit: number | null
    blackDigit: number | null
  }> = []

  try {
    // Step 1: Fetch bets directly — service role bypasses RLS on direct table queries
    const { data: roundBets, error: betsErr } = await supabaseAdmin
      .from('triple_chance_bets')
      .select('*')
      .eq('user_id', playerId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (!betsErr && roundBets && roundBets.length > 0) {
      // Step 2: Fetch related rounds directly — service role bypasses RLS here too
      const roundIds = roundBets.map((b: any) => b.round_id).filter(Boolean)
      let roundsMap: Record<string, any> = {}
      if (roundIds.length > 0) {
        const { data: rounds } = await supabaseAdmin
          .from('triple_chance_rounds')
          .select('id, red, green, black, status')
          .in('id', roundIds)
        ;(rounds || []).forEach((r: any) => { roundsMap[r.id] = r })
      }

      // Step 3: Merge rounds data into bets
      gamePlays = roundBets.map((p: any) => {
        const round = roundsMap[p.round_id] || {}
        const red = round.red !== null && round.red !== undefined ? Number(round.red) : null
        const green = round.green !== null && round.green !== undefined ? Number(round.green) : null
        const black = round.black !== null && round.black !== undefined ? Number(round.black) : null
        const resultNumber = (red !== null && green !== null && black !== null) ? (red * 100 + green * 10 + black) : 0

        const singleBetsObj = (p.single_bets || {}) as Record<string, number>
        const doubleBetsObj = (p.double_bets || {}) as Record<string, number>
        const tripleBetsObj = (p.triple_bets || {}) as Record<string, number>

        const activeModes: string[] = []
        if (Object.keys(singleBetsObj).length > 0) activeModes.push('SINGLE')
        if (Object.keys(doubleBetsObj).length > 0) activeModes.push('DOUBLE')
        if (Object.keys(tripleBetsObj).length > 0) activeModes.push('TRIPLE')
        const modeLabel = activeModes.length > 0 ? activeModes.join(' + ') : 'TRIPLE CHANCE'

        const parts: string[] = []
        if (Object.keys(singleBetsObj).length > 0) parts.push(`Single: ${Object.keys(singleBetsObj).join(',')}`)
        if (Object.keys(doubleBetsObj).length > 0) parts.push(`Double: ${Object.keys(doubleBetsObj).join(',')}`)
        if (Object.keys(tripleBetsObj).length > 0) parts.push(`Triple: ${Object.keys(tripleBetsObj).join(',')}`)
        const selText = parts.length > 0 ? parts.join(' | ') : 'Multi-board Bet'

        const isResolved = p.is_resolved as boolean

        // FIX: Recalculate win from raw bet data + round digits (don't trust stored win_amount
        // which can be stale if a bet row was corrupted by a post-resolution UPSERT)
        let winAmt = 0
        if (red !== null && green !== null && black !== null) {
          const sKey = String(black)
          const dKey = `${green}${black}`
          const tKey = `${red}${green}${black}`
          const sBet = Number(singleBetsObj[sKey] || 0)
          const dBet = Number(doubleBetsObj[dKey] || doubleBetsObj[dKey.padStart(2, '0')] || 0)
          const tBet = Number(tripleBetsObj[tKey] || tripleBetsObj[tKey.padStart(3, '0')] || 0)
          winAmt = (sBet * 9) + (dBet * 90) + (tBet * 900)
        } else {
          winAmt = Number(p.win_amount || 0) // fallback if round digits not available
        }
        const rowStatus: 'WON' | 'LOST' = winAmt > 0 ? 'WON' : 'LOST'

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
          createdAtIso: p.created_at,
          singleBets: singleBetsObj,
          doubleBets: doubleBetsObj,
          tripleBets: tripleBetsObj,
          redDigit: red,
          greenDigit: green,
          blackDigit: black
        }
      })
    }
  } catch (err) {
    console.error('[getPlayerDetailHistoryAction] bets/rounds query failed:', err)
  }

  // 2. Fetch all transaction history from public.transactions
  // WHY NO TYPE FILTER: The only transaction types that exist for players from gameplay
  // are 'bet_stake' and 'win_credit'. The old filter whitelisted only cashier types
  // (agent_topup, deposit, etc.) which excluded ALL gameplay transactions.
  // Fix: include ALL transaction types and label them properly.
  let pointsHistory: Array<{
    id: string
    type: 'deposit' | 'withdraw'
    txType: string
    amount: number
    balanceAfter: number
    date: string
    createdAtIso: string
  }> = []

  try {
    const { data: txns } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', playerId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (txns && txns.length > 0) {
      pointsHistory = txns.map((tx: any) => {
        const amt = Number(tx.amount || 0)
        // M-4 FIX: the previous list referenced agent_credit / deposit /
        // win_credit, none of which exist. isCreditTxn treats the sign of
        // `amount` as authoritative, which is what actually distinguishes a
        // credit from a debit for admin_adjustment rows.
        const isCredit = isCreditTxn(tx.type, amt)
        return {
          id: tx.id.substring(0, 8),
          type: (isCredit ? 'deposit' : 'withdraw') as 'deposit' | 'withdraw',
          txType: tx.type || 'transaction',
          amount: Math.abs(amt),
          balanceAfter: Number(tx.balance_after || 0),
          date: new Date(tx.created_at).toLocaleString('en-US', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          createdAtIso: tx.created_at
        }
      })
    }
  } catch (err) {
    console.error('[getPlayerDetailHistoryAction] transactions query failed:', err)
  }

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


