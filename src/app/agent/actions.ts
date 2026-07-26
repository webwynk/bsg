'use server'

import { createClient as createServerClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

export async function getAgentDashboardDataAction() {
  const supabase = await createServerClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    return { balance: 0, playersCount: 0 }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(authUser.id)
      const freshUser = userData?.user || authUser
      const balance = freshUser.user_metadata?.balance || 0

      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const players = (usersData?.users || []).filter(
        u => u.user_metadata?.role === 'player' && u.user_metadata?.agent_id === authUser.id
      )

      // Calculate today's profit/loss from game_history for this agent's players
      let todaysProfitLoss = 0
      try {
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)

        const { data: spinsToday } = await supabaseAdmin
          .from('game_history')
          .select('bet_amount, win_amount')
          .eq('agent_id', authUser.id)
          .gte('created_at', todayStart.toISOString())

        if (spinsToday) {
          const totalBets = spinsToday.reduce((acc, s) => acc + Number(s.bet_amount || 0), 0)
          const totalWins = spinsToday.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
          todaysProfitLoss = totalBets - totalWins
        }
      } catch (_) {}

      // Fetch last 5 cashier transactions from transactions table
      let recentTransactions: Array<{ id: string; type: 'deposit' | 'withdraw'; amount: number; target: string; date: string }> = []
      try {
        const { data: txns } = await supabaseAdmin
          .from('transactions')
          .select('*')
          .eq('agent_id', authUser.id)
          .order('created_at', { ascending: false })
          .limit(5)

        if (txns) {
          recentTransactions = txns.map(tx => ({
            id: tx.id,
            type: tx.type === 'agent_credit' ? 'deposit' : 'withdraw',
            amount: Math.abs(Number(tx.amount)),
            target: tx.user_username || 'player',
            date: new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }))
        }
      } catch (_) {}

      return {
        balance,
        playersCount: players.length,
        username: freshUser.user_metadata?.username || freshUser.email?.split('@')[0] || 'agent',
        todaysProfitLoss,
        recentTransactions
      }
    } catch (_) {}
  }

  return {
    balance: authUser.user_metadata?.balance || 0,
    playersCount: 0,
    username: authUser.user_metadata?.username || 'agent',
    todaysProfitLoss: 0,
    recentTransactions: []
  }
}

export async function getAgentTransactionHistoryAction() {
  const supabase = await createServerClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    return { transactions: [] }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data: txns } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .eq('agent_id', authUser.id)
        .order('created_at', { ascending: false })
        .limit(200)

      if (txns) {
        const transactions = txns.map(tx => ({
          id: tx.id.substring(0, 8),
          type: (tx.type === 'agent_credit' ? 'deposit' : 'withdraw') as 'deposit' | 'withdraw',
          amount: Math.abs(Number(tx.amount || 0)),
          target: tx.user_username || 'player',
          date: new Date(tx.created_at).toLocaleString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          status: 'Completed'
        }))
        return { transactions }
      }
    } catch (_) {}
  }

  return { transactions: [] }
}
