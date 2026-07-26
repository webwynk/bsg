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

      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      // Execute all sub-queries in parallel via Promise.all
      const [userRes, profilesRes, spinsRes, txnsRes] = await Promise.all([
        supabaseAdmin.auth.admin.getUserById(authUser.id),
        supabaseAdmin.from('profiles').select('id').eq('agent_id', authUser.id),
        supabaseAdmin.from('game_history').select('bet_amount, win_amount').eq('agent_id', authUser.id).gte('created_at', todayStart.toISOString()),
        supabaseAdmin.from('transactions').select('*').eq('agent_id', authUser.id).order('created_at', { ascending: false }).limit(5)
      ])

      const freshUser = userRes.data?.user || authUser
      const balance = freshUser.user_metadata?.balance || 0

      // Players count from indexed profiles table (or fallback to listUsers if profiles is empty)
      let playersCount = profilesRes.data ? profilesRes.data.length : 0
      if (!profilesRes.data || profilesRes.data.length === 0) {
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
        playersCount = (usersData?.users || []).filter(
          u => u.user_metadata?.role === 'player' && u.user_metadata?.agent_id === authUser.id
        ).length
      }

      // Calculate today's profit/loss from game_history
      let todaysProfitLoss = 0
      if (spinsRes.data && spinsRes.data.length > 0) {
        const totalBets = spinsRes.data.reduce((acc, s) => acc + Number(s.bet_amount || 0), 0)
        const totalWins = spinsRes.data.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
        todaysProfitLoss = totalBets - totalWins
      }

      // Format last 5 cashier transactions
      let recentTransactions: Array<{ id: string; type: 'deposit' | 'withdraw'; amount: number; target: string; date: string }> = []
      if (txnsRes.data && txnsRes.data.length > 0) {
        recentTransactions = txnsRes.data.map(tx => ({
          id: tx.id,
          type: tx.type === 'agent_credit' ? 'deposit' : 'withdraw',
          amount: Math.abs(Number(tx.amount)),
          target: tx.user_username || 'player',
          date: new Date(tx.created_at).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
        }))
      }

      return {
        balance,
        playersCount,
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
          date: new Date(tx.created_at).toLocaleString('en-US', {
            timeZone: 'Asia/Kolkata',
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
