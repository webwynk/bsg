'use server'

import { createAdminClient } from '@/lib/supabase'

import { requireAuth } from '@/lib/auth-guard'

/**
 * Agent profit & loss report — v2.
 *
 * Changes from v1:
 *   M-7  The three `game_history` fallback queries are gone. That table does
 *        not exist, so each returned an error and the
 *        `rounds.length > 0 ? rounds : hist` merges could only ever pick one
 *        side anyway.
 *   A-8  targetAgentId is honoured only for a superadmin. An agent always
 *        reports on themselves, so one agent can no longer read another's P&L
 *        by passing their id.
 *   S-4  agent_id only. No parent_agent_id.
 *
 * House profit is stake minus payout. Both figures come from `bets`, written by
 * settle_round(), so the report and the player's own history cannot disagree.
 */

export interface ProfitReportParams {
  targetAgentId?: string
  datePreset?: 'today' | '7days' | '30days' | 'lifetime'
  filterDate?: string
  searchQuery?: string
  page?: number
  limit?: number
}

export interface PlayerProfitRow {
  id: string
  full_name: string
  username: string
  is_active: boolean
  coin_balance: number
  play_count: number
  total_stake: number
  total_payout: number
  net_profit: number
  margin_pct: number
  last_played_at: string | null
}

export interface ProfitReport {
  summary: {
    todays_profit: number
    lifetime_profit: number
    total_stake: number
    total_payout: number
    margin_pct: number
  }
  players: PlayerProfitRow[]
  total_pages: number
  total_items: number
  error: string | null
}

const EMPTY: ProfitReport = {
  summary: { todays_profit: 0, lifetime_profit: 0, total_stake: 0, total_payout: 0, margin_pct: 0 },
  players: [], total_pages: 1, total_items: 0, error: null,
}


/** IST day boundaries for the selected preset or explicit date. */
function istRange(preset?: string, filterDate?: string) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const dayStart = new Date(`${today}T00:00:00+05:30`)

  let start: string | undefined
  let end: string | undefined

  if (filterDate) {
    const d = new Date(filterDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    start = new Date(`${d}T00:00:00+05:30`).toISOString()
    end   = new Date(`${d}T23:59:59.999+05:30`).toISOString()
  } else if (preset === 'today') {
    start = dayStart.toISOString()
    end   = new Date(`${today}T23:59:59.999+05:30`).toISOString()
  } else if (preset === '7days') {
    start = new Date(dayStart.getTime() - 7 * 86_400_000).toISOString()
  } else if (preset === '30days') {
    start = new Date(dayStart.getTime() - 30 * 86_400_000).toISOString()
  }
  // 'lifetime' leaves both undefined.

  return { dayStartISO: dayStart.toISOString(), start, end }
}

export async function getAgentProfitReportAction(
  params: ProfitReportParams = {}
): Promise<ProfitReport> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { ...EMPTY, error: auth.error }

  // A-8: an agent may only ever report on their own book.
  const agentId = auth.user.role === 'superadmin' && params.targetAgentId
    ? params.targetAgentId
    : auth.user.id

  try {
    const db = createAdminClient()
    const { dayStartISO, start, end } = istRange(params.datePreset, params.filterDate)

    // The roster first — the report lists every player, including those with no
    // activity in the window, so an agent can see who is idle.
    const playersRes = await db
      .from('profiles')
      .select('id, username, full_name, coin_balance, is_active')
      .eq('agent_id', agentId)
      .order('username')
    if (playersRes.error) throw new Error(`players: ${playersRes.error.message}`)

    const players = playersRes.data ?? []
    const playerIds = players.map(p => p.id)

    if (playerIds.length === 0) return { ...EMPTY }

    let filtered = db.from('bets')
      .select('user_id, total_stake, total_payout, created_at')
      .in('user_id', playerIds).range(0, 999999)
    if (start) filtered = filtered.gte('created_at', start)
    if (end)   filtered = filtered.lte('created_at', end)

    const [allRes, todayRes, filteredRes] = await Promise.all([
      db.from('bets').select('total_stake, total_payout')
        .in('user_id', playerIds).range(0, 999999),
      db.from('bets').select('total_stake, total_payout')
        .in('user_id', playerIds).gte('created_at', dayStartISO).range(0, 999999),
      filtered,
    ])
    if (allRes.error)      throw new Error(`lifetime: ${allRes.error.message}`)
    if (todayRes.error)    throw new Error(`today: ${todayRes.error.message}`)
    if (filteredRes.error) throw new Error(`filtered: ${filteredRes.error.message}`)

    const profitOf = (rows: Array<{ total_stake: unknown; total_payout: unknown }>) =>
      rows.reduce((s, r) => s + (Number(r.total_stake ?? 0) - Number(r.total_payout ?? 0)), 0)

    const total_stake  = (filteredRes.data ?? []).reduce((s, r) => s + Number(r.total_stake ?? 0), 0)
    const total_payout = (filteredRes.data ?? []).reduce((s, r) => s + Number(r.total_payout ?? 0), 0)

    // Per-player aggregation over the filtered window.
    const stats = new Map<string, { plays: number; stake: number; payout: number; last: string | null }>()
    for (const b of filteredRes.data ?? []) {
      const cur = stats.get(b.user_id) ?? { plays: 0, stake: 0, payout: 0, last: null }
      cur.plays += 1
      cur.stake += Number(b.total_stake ?? 0)
      cur.payout += Number(b.total_payout ?? 0)
      if (!cur.last || b.created_at > cur.last) cur.last = b.created_at
      stats.set(b.user_id, cur)
    }

    let rows: PlayerProfitRow[] = players.map(p => {
      const s = stats.get(p.id) ?? { plays: 0, stake: 0, payout: 0, last: null }
      const net = s.stake - s.payout
      return {
        id: p.id,
        full_name: p.full_name || p.username,
        username: p.username,
        is_active: p.is_active,
        coin_balance: Number(p.coin_balance ?? 0),
        play_count: s.plays,
        total_stake: s.stake,
        total_payout: s.payout,
        net_profit: net,
        margin_pct: s.stake > 0 ? (net / s.stake) * 100 : 0,
        last_played_at: s.last,
      }
    })

    // When a window is selected, show only players who actually played in it.
    if (start || end) rows = rows.filter(r => r.play_count > 0)

    if (params.searchQuery?.trim()) {
      const q = params.searchQuery.trim().toLowerCase()
      rows = rows.filter(r =>
        r.username.toLowerCase().includes(q) || r.full_name.toLowerCase().includes(q))
    }

    rows.sort((a, b) => b.total_stake - a.total_stake)

    const page = Math.max(1, params.page ?? 1)
    const limit = Math.min(100, Math.max(1, params.limit ?? 10))
    const total_items = rows.length

    return {
      summary: {
        todays_profit: profitOf(todayRes.data ?? []),
        lifetime_profit: profitOf(allRes.data ?? []),
        total_stake,
        total_payout,
        margin_pct: total_stake > 0 ? ((total_stake - total_payout) / total_stake) * 100 : 0,
      },
      players: rows.slice((page - 1) * limit, page * limit),
      total_pages: Math.max(1, Math.ceil(total_items / limit)),
      total_items,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ...EMPTY, error: `Could not load report: ${message}` }
  }
}
