'use server'

import { createClient as createServerClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

export async function getAgentDashboardDataAction() {
  const supabase = await createServerClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    return { balance: 0, playersCount: 0, players: [], todaysBets: 0, todaysWins: 0, todaysProfitLoss: 0, recentTransactions: [] }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      // Calculate Asia/Kolkata (IST - UTC+5:30) today start (00:00:00 IST)
      const now = new Date()
      const istTodayString = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // 'YYYY-MM-DD'
      const istTodayStart = new Date(`${istTodayString}T00:00:00+05:30`)
      const todayStartISO = istTodayStart.toISOString()

      // Execute all sub-queries in parallel via Promise.all
      const [agentProfRes, playersProfRes, spinsRes] = await Promise.all([
        supabaseAdmin.from('profiles').select('username, balance').eq('id', authUser.id).maybeSingle(),
        supabaseAdmin.from('profiles').select('id, username, balance, is_active').eq('agent_id', authUser.id),
        supabaseAdmin.from('game_history').select('bet_amount, win_amount').eq('agent_id', authUser.id).gte('created_at', todayStartISO)
      ])

      // Fetch all auth users to extract full_name metadata
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const allUsers = usersData?.users || []

      const balance = agentProfRes.data ? Number(agentProfRes.data.balance || 0) : (authUser.user_metadata?.balance || 0)
      const username = agentProfRes.data?.username || authUser.user_metadata?.username || authUser.email?.split('@')[0] || 'agent'
      const agentName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || username
      const rawJoined = authUser.created_at
      const joinedDate = rawJoined ? new Date(rawJoined).toLocaleDateString('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }) : 'Jul 28, 2026'

      // Player list for dropdown and count
      let players: Array<{ id: string; name: string; username: string; balance: number }> = []
      if (playersProfRes.data && playersProfRes.data.length > 0) {
        players = playersProfRes.data.map(p => {
          const u = allUsers.find(user => user.id === p.id)
          const fullName = u?.user_metadata?.full_name || u?.user_metadata?.name || p.username || 'Player'
          return {
            id: p.id,
            name: fullName,
            username: p.username || '',
            balance: Number(p.balance || 0)
          }
        })
      } else {
        players = allUsers
          .filter(u => u.user_metadata?.role === 'player' && u.user_metadata?.agent_id === authUser.id)
          .map(u => ({
            id: u.id,
            name: u.user_metadata?.full_name || u.user_metadata?.name || u.email?.split('@')[0] || 'Player',
            username: u.user_metadata?.username || u.email?.split('@')[0] || '',
            balance: u.user_metadata?.balance || 0
          }))
      }

      const playerIds = (playersProfRes.data || []).map(p => p.id)
      const allTargetUserIds = [authUser.id, ...playerIds]

      // Fetch last 20 transactions for agent & agent's players
      let txnsData: any[] = []
      try {
        const { data: rawTxns } = await supabaseAdmin
          .from('transactions')
          .select('*')
          .or(`agent_id.eq.${authUser.id},user_id.in.(${allTargetUserIds.join(',')})`)
          .order('created_at', { ascending: false })
          .limit(20)
        txnsData = rawTxns || []
      } catch (_) {
        const { data: fallbackTxns } = await supabaseAdmin
          .from('transactions')
          .select('*')
          .eq('agent_id', authUser.id)
          .order('created_at', { ascending: false })
          .limit(20)
        txnsData = fallbackTxns || []
      }

      let todaysBets = 0
      let todaysWins = 0
      let todaysProfitLoss = 0

      if (playerIds.length > 0) {
        const { data: todayBetsData } = await supabaseAdmin
          .from('triple_chance_bets')
          .select('total_stake, win_amount')
          .in('user_id', playerIds)
          .gte('created_at', todayStartISO)

        if (todayBetsData && todayBetsData.length > 0) {
          todaysBets = todayBetsData.reduce((acc, s) => acc + Number(s.total_stake || 0), 0)
          todaysWins = todayBetsData.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
          todaysProfitLoss = todaysBets - todaysWins
        } else if (spinsRes.data && spinsRes.data.length > 0) {
          todaysBets = spinsRes.data.reduce((acc, s) => acc + Number(s.bet_amount || 0), 0)
          todaysWins = spinsRes.data.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
          todaysProfitLoss = todaysBets - todaysWins
        }
      }

      // Format last 20 cashier transactions
      let recentTransactions: Array<{ id: string; type: 'deposit' | 'withdraw'; amount: number; target: string; targetUsername: string; date: string }> = []
      if (txnsData && txnsData.length > 0) {
        recentTransactions = txnsData
          .filter(tx => ['agent_topup', 'agent_deduct', 'agent_credit', 'agent_debit', 'deposit', 'withdraw', 'admin_adjustment'].includes(tx.type))
          .map(tx => {
            const amt = Number(tx.amount || 0)
            const isDep = tx.type === 'agent_topup' || tx.type === 'agent_credit' || tx.type === 'deposit' || (tx.type === 'admin_adjustment' && amt >= 0)
            
            const playerProf = (playersProfRes.data || []).find(p => p.id === tx.user_id)
            const playerUser = allUsers.find(u => u.id === tx.user_id)
            
            let targetName = 'Superadmin'
            let targetUsername = 'Superadmin'

            if (playerProf || (playerUser && playerUser.id !== authUser.id)) {
              const pUsername = playerProf?.username || playerUser?.user_metadata?.username || 'player'
              targetName = playerUser?.user_metadata?.full_name || playerUser?.user_metadata?.name || pUsername
              targetUsername = `@${pUsername.replace(/^@+/, '')}`
            }

            return {
              id: tx.id,
              type: (isDep ? 'deposit' : 'withdraw') as 'deposit' | 'withdraw',
              amount: Math.abs(amt),
              target: targetName,
              targetUsername: targetUsername,
              date: new Date(tx.created_at).toLocaleString('en-US', {
                timeZone: 'Asia/Kolkata',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })
            }
          })
      }

      return {
        balance,
        playersCount: players.length,
        players,
        name: agentName,
        username,
        joinedDate,
        todaysBets,
        todaysWins,
        todaysProfitLoss,
        recentTransactions
      }
    } catch (_) {}
  }

  return {
    balance: authUser.user_metadata?.balance || 0,
    playersCount: 0,
    players: [],
    name: authUser.user_metadata?.full_name || authUser.user_metadata?.username || 'agent',
    username: authUser.user_metadata?.username || 'agent',
    joinedDate: 'Jul 28, 2026',
    todaysBets: 0,
    todaysWins: 0,
    todaysProfitLoss: 0,
    recentTransactions: []
  }
}

export async function getAgentTransactionHistoryAction() {
  const supabase = await createServerClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    return { balance: 0, transactions: [] }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (!serviceRoleKey || !supabaseUrl) {
    return { balance: 0, transactions: [] }
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const [profRes, txnsRes, usersRes] = await Promise.all([
      supabaseAdmin.from('profiles').select('balance').eq('id', authUser.id).single(),
      supabaseAdmin
        .from('transactions')
        .select('*, user:profiles!transactions_user_id_fkey(username), agent:profiles!transactions_agent_id_fkey(username)')
        .or(`agent_id.eq.${authUser.id},user_id.eq.${authUser.id}`)
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseAdmin.auth.admin.listUsers()
    ])

    const balance = Number(profRes.data?.balance || 0)
    const txnsData = txnsRes.data
    const allUsers = usersRes.data?.users || []

    if (txnsRes.error || !txnsData) {
      return { balance, transactions: [] }
    }

    const formatted = txnsData
      .filter(tx => ['agent_topup', 'agent_deduct', 'agent_credit', 'agent_debit', 'deposit', 'withdraw', 'admin_adjustment'].includes(tx.type))
      .map(tx => {
        const isAgentPlayerTxn = tx.agent_id === authUser.id && tx.user_id !== authUser.id
        const isSuperadminTxn = tx.user_id === authUser.id

        let target = 'Superadmin'
        let targetUsername = 'Superadmin'

        if (isAgentPlayerTxn) {
          const playerUser = allUsers.find(u => u.id === tx.user_id)
          const pUsername = tx.user?.username || playerUser?.user_metadata?.username || 'player'
          target = playerUser?.user_metadata?.full_name || playerUser?.user_metadata?.name || pUsername
          targetUsername = `@${pUsername.replace(/^@+/, '')}`
        }

        const amt = Number(tx.amount || 0)
        let txType: 'deposit' | 'withdraw' = 'deposit'
        if (tx.type === 'agent_topup' || tx.type === 'agent_credit' || (tx.type === 'admin_adjustment' && amt >= 0)) {
          txType = 'deposit'
        } else if (tx.type === 'agent_deduct' || tx.type === 'agent_debit' || (tx.type === 'admin_adjustment' && amt < 0)) {
          txType = 'withdraw'
        }

        return {
          id: tx.id,
          category: (isSuperadminTxn ? 'superadmin' : 'player') as 'superadmin' | 'player',
          type: txType,
          amount: Math.abs(amt),
          target,
          targetUsername,
          status: 'Success',
          created_at: tx.created_at,
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

    return { balance, transactions: formatted }
  } catch (_) {}

  return { balance: 0, transactions: [] }
}
