'use server'

import { requireAuth } from '@/lib/auth-guard'
import { runAgentProfitReport, EMPTY_PROFIT_REPORT } from './profit-report-logic'

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
  /** Issue #90 fix: a plain `YYYY-MM-DD` day the caller already resolved
   * (via `pickedDayKey`), NOT an ISO instant -- re-deriving "which IST day"
   * from a client-constructed instant is exactly the bug this replaced. */
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

/**
 * Issue #93: thin requireAuth() wrapper -- the actual query/aggregation logic
 * now lives in profit-report-logic.ts's runAgentProfitReport, shared with
 * getAgentDetailBundleAction (superadmin/agents/actions.ts) so that page can
 * fold this report into its one combined action instead of a separate
 * requireAuth() round-trip per poll cycle.
 */
export async function getAgentProfitReportAction(
  params: ProfitReportParams = {}
): Promise<ProfitReport> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { ...EMPTY_PROFIT_REPORT, error: auth.error }
  return runAgentProfitReport(auth.user, params)
}
