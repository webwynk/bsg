import { createAdminClient } from '@/lib/supabase'
import { resolveAgentId } from '@/app/superadmin/agents/resolve-agent-id'
import { fetchMoneySummary, fetchPlayerMoneyRows } from '@/lib/money-totals'
import { combineGames, houseResult, marginPct, EMPTY_MONEY_SUMMARY } from '@/lib/money-totals-logic'
import type { ProfitReportParams, ProfitReport, PlayerProfitRow } from './actions'

export const EMPTY_PROFIT_REPORT: ProfitReport = {
  summary: { todays_profit: 0, lifetime_profit: 0, total_stake: 0, total_payout: 0, margin_pct: 0, split: EMPTY_MONEY_SUMMARY },
  players: [], total_pages: 1, total_items: 0, error: null,
}

/** IST day boundaries for the selected preset or explicit date. */
function istRange(preset?: string, filterDate?: string) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const dayStart = new Date(`${today}T00:00:00+05:30`)

  let start: string | undefined
  let end: string | undefined

  if (filterDate) {
    // Issue #90 fix: filterDate is already the exact day the caller resolved
    // (pickedDayKey, read from the picker's own local y/m/d) -- no instant to
    // re-derive an IST day from anymore, so no re-conversion here. The old
    // `new Date(filterDate).toLocaleDateString(...)` round-trip re-interpreted
    // whatever instant the client happened to send, which is exactly what let
    // a non-IST browser's local-midnight construction silently resolve to the
    // wrong day.
    start = new Date(`${filterDate}T00:00:00+05:30`).toISOString()
    end   = new Date(`${filterDate}T23:59:59.999+05:30`).toISOString()
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

/**
 * Issue #93: core profit-report logic, extracted out of the 'use server'
 * getAgentProfitReportAction so it can also be called, already-authorized,
 * from getAgentDetailBundleAction (superadmin/agents/actions.ts) without a
 * second requireAuth() round-trip. Deliberately NOT exported from a 'use
 * server' file: doing so would make it directly callable as its own Server
 * Action, bypassing requireAuth() entirely for a caller who forges the
 * `caller` argument -- this file has no directive, so it is plain
 * server-only code, reachable only through callers that have already
 * verified `caller` themselves via requireAuth().
 *
 * House profit is stake minus payout. Both figures come from the bets of BOTH
 * games (`bets` for Triple Chance, written by settle_round(), and
 * `lucky_card_bets`), so the report and the player's own history cannot
 * disagree. Issue #122 / Lucky Card D3: they are added up by the database (the
 * old code downloaded every bet row, which silently stopped at 1,000 rows).
 */
export async function runAgentProfitReport(
  caller: { id: string; role: string },
  params: ProfitReportParams = {}
): Promise<ProfitReport> {
  // A-8: an agent may only ever report on their own book. For a superadmin,
  // targetAgentId may arrive as a username (first load, before the caller has
  // resolved it) or an already-resolved UUID -- resolveAgentId handles both,
  // so this stays correct regardless of what the caller passes.
  let agentId = caller.id
  if (caller.role === 'superadmin' && params.targetAgentId) {
    const resolved = await resolveAgentId(params.targetAgentId)
    if (!resolved) return { ...EMPTY_PROFIT_REPORT, error: 'Agent not found.' }
    agentId = resolved
  }

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

    if (playerIds.length === 0) return { ...EMPTY_PROFIT_REPORT }

    // The three totals (lifetime, today, the selected window) for both games in
    // one call, and one row per player who played in the window. The database
    // scopes both to this agent's players itself.
    const [money, playerRows] = await Promise.all([
      fetchMoneySummary({ agentId, dayStart: dayStartISO, from: start, to: end }),
      fetchPlayerMoneyRows(agentId, start, end),
    ])

    const windowTotal = combineGames(money.window)
    const total_stake  = windowTotal.stake
    const total_payout = windowTotal.payout

    // Per-player figures over the filtered window (both games combined per player).
    const stats = new Map(playerRows.map(r => [r.user_id, r]))

    let rows: PlayerProfitRow[] = players.map(p => {
      const found = stats.get(p.id)
      const s = { plays: found?.plays ?? 0, stake: found?.stake ?? 0, payout: found?.payout ?? 0, last: found?.last_played_at ?? null }
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
        todays_profit: houseResult(combineGames(money.today)),
        lifetime_profit: houseResult(combineGames(money.lifetime)),
        total_stake,
        total_payout,
        margin_pct: marginPct(windowTotal),
        split: money,
      },
      players: rows.slice((page - 1) * limit, page * limit),
      total_pages: Math.max(1, Math.ceil(total_items / limit)),
      total_items,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ...EMPTY_PROFIT_REPORT, error: `Could not load report: ${message}` }
  }
}
