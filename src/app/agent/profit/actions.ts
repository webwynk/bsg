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

// Helper to compute Asia/Kolkata (IST) date boundaries for daily reset
function getISTDateRange(datePreset?: string, filterDate?: string) {
  const now = new Date()
  const istTodayString = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // 'YYYY-MM-DD'
  const todayStart = new Date(`${istTodayString}T00:00:00+05:30`)

  let startDate: string | undefined = undefined
  let endDate: string | undefined = undefined

  if (filterDate) {
    const dStr = new Date(filterDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    startDate = new Date(`${dStr}T00:00:00+05:30`).toISOString()
    endDate = new Date(`${dStr}T23:59:59.999+05:30`).toISOString()
  } else if (datePreset === 'today') {
    startDate = todayStart.toISOString()
    endDate = new Date(`${istTodayString}T23:59:59.999+05:30`).toISOString()
  } else if (datePreset === '7days') {
    const d7 = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000)
    startDate = d7.toISOString()
  } else if (datePreset === '30days') {
    const d30 = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000)
    startDate = d30.toISOString()
  }
  // 'lifetime' or 'all' leaves startDate and endDate undefined

  return { todayStartISO: todayStart.toISOString(), startDate, endDate }
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

    const { todayStartISO, startDate, endDate } = getISTDateRange(params.datePreset, params.filterDate)

    // Build history query for filtered period
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

    // Execute queries in parallel
    const [allSpinsRes, todaySpinsRes, filteredSpinsRes, profilesRes, authUsersRes] = await Promise.all([
      // 1. All spins for lifetime summary
      supabaseAdmin.from('game_history').select('bet_amount, win_amount').eq('agent_id', agentId),
      // 2. Today's spins for daily reset summary (Asia/Kolkata 00:00:00+)
      supabaseAdmin.from('game_history').select('bet_amount, win_amount').eq('agent_id', agentId).gte('created_at', todayStartISO),
      // 3. Filtered spins for breakdown
      historyQuery,
      // 4. Profiles table (if populated)
      supabaseAdmin.from('profiles').select('id, username, is_active, balance').eq('agent_id', agentId),
      // 5. Auth users list (fallback/primary store for users)
      supabaseAdmin.auth.admin.listUsers()
    ])

    const allSpins = allSpinsRes.data || []
    const todaySpins = todaySpinsRes.data || []
    const filteredSpins = filteredSpinsRes.data || []

    // Summary calculations
    const todaysPnl = todaySpins.reduce((acc, s) => acc + (Number(s.bet_amount || 0) - Number(s.win_amount || 0)), 0)
    const lifetimePnl = allSpins.reduce((acc, s) => acc + (Number(s.bet_amount || 0) - Number(s.win_amount || 0)), 0)

    const totalVolume = filteredSpins.reduce((acc, s) => acc + Number(s.bet_amount || 0), 0)
    const totalPayouts = filteredSpins.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
    const filteredPnl = totalVolume - totalPayouts
    const netMarginPct = totalVolume > 0 ? (filteredPnl / totalVolume) * 100 : 0

    // Build combined player dictionary (profiles + auth.users)
    const playerDict: Record<string, { username: string; isActive: boolean; balance: number }> = {}

    // First populate from profiles table
    if (profilesRes.data) {
      profilesRes.data.forEach(p => {
        playerDict[p.id] = {
          username: p.username || 'Player',
          isActive: p.is_active ?? true,
          balance: Number(p.balance || 0)
        }
      })
    }

    // Next populate/override from auth.users metadata
    if (authUsersRes.data?.users) {
      authUsersRes.data.users.forEach(u => {
        const meta = u.user_metadata || {}
        if (meta.role === 'player' && (meta.agent_id === agentId || !playerDict[u.id])) {
          playerDict[u.id] = {
            username: meta.username || meta.full_name || u.email?.split('@')[0] || 'Player',
            isActive: meta.status !== 'Blocked',
            balance: Number(meta.balance || 0)
          }
        }
      })
    }

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

    // Collect all player IDs from dictionary AND from spin stats map
    const allPlayerIds = Array.from(new Set([...Object.keys(playerDict), ...Object.keys(playerStatsMap)]))

    let playerBreakdowns = allPlayerIds.map(uid => {
      const info = playerDict[uid] || { username: `Player (${uid.substring(0, 6)})`, isActive: true, balance: 0 }
      const stats = playerStatsMap[uid] || { totalPlays: 0, totalBets: 0, totalWins: 0, lastPlayedAt: '' }
      const netPnl = stats.totalBets - stats.totalWins
      const marginPct = stats.totalBets > 0 ? (netPnl / stats.totalBets) * 100 : 0

      return {
        id: uid,
        username: info.username,
        isActive: info.isActive,
        balance: info.balance,
        totalPlays: stats.totalPlays,
        totalBets: stats.totalBets,
        totalWins: stats.totalWins,
        netPnl,
        marginPct,
        lastPlayedAt: stats.lastPlayedAt
      }
    })

    // If filtering by date or preset, keep only players who had activity or are registered
    if (startDate || endDate) {
      playerBreakdowns = playerBreakdowns.filter(p => p.totalPlays > 0)
    }

    // Search filter
    if (params.searchQuery && params.searchQuery.trim()) {
      const q = params.searchQuery.trim().toLowerCase()
      playerBreakdowns = playerBreakdowns.filter(p => p.username.toLowerCase().includes(q))
    }

    // Sort by Total Bets descending
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
