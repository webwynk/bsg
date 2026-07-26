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
      const [agentProfRes, playersProfRes, spinsRes, txnsRes] = await Promise.all([
        supabaseAdmin.from('profiles').select('username, balance').eq('id', authUser.id).maybeSingle(),
        supabaseAdmin.from('profiles').select('id, username, balance, is_active').eq('agent_id', authUser.id),
        supabaseAdmin.from('game_history').select('bet_amount, win_amount').eq('agent_id', authUser.id).gte('created_at', todayStartISO),
        supabaseAdmin.from('transactions').select('*').eq('agent_id', authUser.id).order('created_at', { ascending: false }).limit(5)
      ])

      const balance = agentProfRes.data ? Number(agentProfRes.data.balance || 0) : (authUser.user_metadata?.balance || 0)
      const username = agentProfRes.data?.username || authUser.user_metadata?.username || authUser.email?.split('@')[0] || 'agent'

      // Player list for dropdown and count
      let players: Array<{ id: string; name: string; username: string; balance: number }> = []
      if (playersProfRes.data && playersProfRes.data.length > 0) {
        players = playersProfRes.data.map(p => ({
          id: p.id,
          name: p.username || 'Player',
          username: p.username || '',
          balance: Number(p.balance || 0)
        }))
      } else {
        // Fallback to Auth listUsers if profiles table is empty
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
        players = (usersData?.users || [])
          .filter(u => u.user_metadata?.role === 'player' && u.user_metadata?.agent_id === authUser.id)
          .map(u => ({
            id: u.id,
            name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'Player',
            username: u.user_metadata?.username || u.email?.split('@')[0] || '',
            balance: u.user_metadata?.balance || 0
          }))
      }

      // Calculate today's bets, wins, and net profit/loss from game_history (IST timezone 00:00:00+)
      let todaysBets = 0
      let todaysWins = 0
      let todaysProfitLoss = 0

      if (spinsRes.data && spinsRes.data.length > 0) {
        todaysBets = spinsRes.data.reduce((acc, s) => acc + Number(s.bet_amount || 0), 0)
        todaysWins = spinsRes.data.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
        todaysProfitLoss = todaysBets - todaysWins
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
        playersCount: players.length,
        players,
        username,
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
    username: authUser.user_metadata?.username || 'agent',
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
    return { transactions: [] }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (!serviceRoleKey || !supabaseUrl) {
    return { transactions: [] }
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: txns } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('agent_id', authUser.id)
      .order('created_at', { ascending: false })

    const formatted = (txns || []).map(tx => ({
      id: tx.id,
      type: (tx.type === 'agent_credit' ? 'deposit' : 'withdraw') as 'deposit' | 'withdraw',
      amount: Math.abs(Number(tx.amount)),
      target: tx.user_username || 'player',
      status: 'Success',
      date: new Date(tx.created_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    }))

    return { transactions: formatted }
  } catch (err) {
    return { transactions: [] }
  }
}
