'use server'

import { createClient as createServerClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

export interface AgentProfitReportParams {
  targetAgentId?: string
  datePreset?: 'today' | '7days' | '30days' | 'lifetime' | 'all'
  filterDate?: string
  searchQuery?: string
  page?: number
  limit?: number
}

export async function getAgentProfitReportAction(params: AgentProfitReportParams = {}) {
  const supabase = await createServerClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    return {
      summary: { todaysPnl: 0, lifetimePnl: 0, totalVolume: 0, totalPayouts: 0, netMarginPct: 0 },
      players: [],
      totalPages: 1,
      totalItems: 0
    }
  }

  const agentId = params.targetAgentId || authUser.id

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (!serviceRoleKey || !supabaseUrl) {
    return {
      summary: { todaysPnl: 0, lifetimePnl: 0, totalVolume: 0, totalPayouts: 0, netMarginPct: 0 },
      players: [],
      totalPages: 1,
      totalItems: 0
    }
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // Determine date filter boundaries for table breakdown
    let startDate: string | undefined = undefined
    let endDate: string | undefined = undefined

    if (params.filterDate) {
      const d = new Date(params.filterDate)
      d.setHours(0, 0, 0, 0)
      startDate = d.toISOString()
      const dEnd = new Date(params.filterDate)
      dEnd.setHours(23, 59, 59, 999)
      endDate = dEnd.toISOString()
    } else if (params.datePreset === 'today') {
      startDate = todayStart.toISOString()
    } else if (params.datePreset === '7days') {
      const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      startDate = d7.toISOString()
    } else if (params.datePreset === '30days') {
      const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      startDate = d30.toISOString()
    }

    // Parallel execution for speed
    let historyQuery = supabaseAdmin
      .from('game_history')
      .select('user_id, bet_amount, win_amount, created_at')
      .eq('agent_id', agentId)

    if (startDate) {
      historyQuery = historyQuery.gte('created_at', startDate)
    }
    if (endDate) {
      historyQuery = historyQuery.lte('created_at', endDate)
    }

    const [allSpinsRes, todaySpinsRes, filteredSpinsRes, playersRes] = await Promise.all([
      // Lifetime summary spins
      supabaseAdmin.from('game_history').select('bet_amount, win_amount').eq('agent_id', agentId),
      // Today summary spins
      supabaseAdmin.from('game_history').select('bet_amount, win_amount').eq('agent_id', agentId).gte('created_at', todayStart.toISOString()),
      // Filtered spins for player breakdown
      historyQuery,
      // Agent's registered players
      supabaseAdmin.from('profiles').select('id, username, is_active, balance').eq('agent_id', agentId)
    ])

    // Calculate Summary Metrics
    const allSpins = allSpinsRes.data || []
    const todaySpins = todaySpinsRes.data || []
    const filteredSpins = filteredSpinsRes.data || []
    const playersList = playersRes.data || []

    const todaysPnl = todaySpins.reduce((acc, s) => acc + (Number(s.bet_amount || 0) - Number(s.win_amount || 0)), 0)
    const lifetimePnl = allSpins.reduce((acc, s) => acc + (Number(s.bet_amount || 0) - Number(s.win_amount || 0)), 0)

    const totalVolume = filteredSpins.reduce((acc, s) => acc + Number(s.bet_amount || 0), 0)
    const totalPayouts = filteredSpins.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
    const filteredPnl = totalVolume - totalPayouts
    const netMarginPct = totalVolume > 0 ? (filteredPnl / totalVolume) * 100 : 0

    // Group filtered spins by player user_id
    const playerStatsMap: Record<string, { totalPlays: number; totalBets: number; totalWins: number; lastPlayedAt: string }> = {}

    filteredSpins.forEach(spin => {
      const uid = spin.user_id
      if (!uid) return
      if (!playerStatsMap[uid]) {
        playerStatsMap[uid] = { totalPlays: 0, totalBets: 0, totalWins: 0, lastPlayedAt: spin.created_at }
      }
      playerStatsMap[uid].totalPlays += 1
      playerStatsMap[uid].totalBets += Number(spin.bet_amount || 0)
      playerStatsMap[uid].totalWins += Number(spin.win_amount || 0)
      if (new Date(spin.created_at) > new Date(playerStatsMap[uid].lastPlayedAt)) {
        playerStatsMap[uid].lastPlayedAt = spin.created_at
      }
    })

    // Map all players registered under this agent
    let playerBreakdowns = playersList.map(p => {
      const stats = playerStatsMap[p.id] || { totalPlays: 0, totalBets: 0, totalWins: 0, lastPlayedAt: '' }
      const netPnl = stats.totalBets - stats.totalWins
      const marginPct = stats.totalBets > 0 ? (netPnl / stats.totalBets) * 100 : 0
      return {
        id: p.id,
        username: p.username || 'Player',
        isActive: p.is_active ?? true,
        balance: Number(p.balance || 0),
        totalPlays: stats.totalPlays,
        totalBets: stats.totalBets,
        totalWins: stats.totalWins,
        netPnl,
        marginPct,
        lastPlayedAt: stats.lastPlayedAt
      }
    })

    // Filter by search query if provided
    if (params.searchQuery && params.searchQuery.trim()) {
      const q = params.searchQuery.trim().toLowerCase()
      playerBreakdowns = playerBreakdowns.filter(p => p.username.toLowerCase().includes(q))
    }

    // Sort by Total Bets descending (or Net P/L magnitude)
    playerBreakdowns.sort((a, b) => b.totalBets - a.totalBets)

    // Pagination
    const page = params.page || 1
    const limit = params.limit || 10
    const totalItems = playerBreakdowns.length
    const totalPages = Math.ceil(totalItems / limit) || 1
    const paginatedPlayers = playerBreakdowns.slice((page - 1) * limit, page * limit)

    return {
      summary: {
        todaysPnl,
        lifetimePnl,
        totalVolume,
        totalPayouts,
        netMarginPct
      },
      players: paginatedPlayers,
      totalPages,
      totalItems
    }
  } catch (err) {
    return {
      summary: { todaysPnl: 0, lifetimePnl: 0, totalVolume: 0, totalPayouts: 0, netMarginPct: 0 },
      players: [],
      totalPages: 1,
      totalItems: 0
    }
  }
}
