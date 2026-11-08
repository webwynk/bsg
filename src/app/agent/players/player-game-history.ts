import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import { LC_BET_COLUMNS, shapePlayerPlay as shapeLuckyCard, type PlayerLuckyCardBetRow, type PlayerLuckyCardPlay } from '@/lib/lucky-card'
import { S2W_BET_COLUMNS, shapePlayerPlay as shapeSpin2Win, type PlayerSpin2WinBetRow, type PlayerSpin2WinPlay } from '@/lib/spin2win'
import { L16_BET_COLUMNS, shapePlayerPlay as shapeLucky16, type PlayerLucky16BetRow, type PlayerLucky16Play } from '@/lib/lucky16'
import { readByGameFrom, type GameKey, type MoneyByGame } from '@/lib/money-totals-logic'
import { rangeToInstants, type DayRange } from '@/lib/gameplay-range'
import { HISTORY_PAGE_SIZE, type HistoryOutcome } from '@/lib/player-history-filter'
import { TC_BET_SELECT, shapeTripleChanceBet, type TripleChanceBetRow } from './player-history-logic'
import { istDateTime } from './players-shared'
import type { PlayerGamePlay } from './actions'

/**
 * Player History page (superadmin + agent, components/player-game-history.tsx):
 * one player's figures and plays per game, for any IST date range.
 *
 * Deliberately NOT a 'use server' file: these functions trust their caller and
 * must only be reached through player-game-history-actions.ts, which checks the
 * login and that an agent only reads their own players.
 *
 *  - fetchPlayerGameStats: plays / coins bet / coins won per game, added up by
 *    the database (staff_player_money_summary), so nothing is capped.
 *  - fetchPlayerGamePlays: one page of one game's plays, newest first, with an
 *    exact total for the filter -- replaces "the last 100 plays" the page used
 *    to load and filter in the browser.
 *
 * Outcome filter: WON = something was paid; LOST = settled with nothing paid.
 * A round still running (not settled) shows only under "All".
 */

export type PlayerHistoryPlay =
  | { game: 'triple_chance'; play: PlayerGamePlay }
  | { game: 'lucky_card'; play: PlayerLuckyCardPlay }
  | { game: 'spin2win'; play: PlayerSpin2WinPlay }
  | { game: 'lucky16'; play: PlayerLucky16Play }

const SOURCES: Record<GameKey, { table: string; rounds: string; select: string }> = {
  triple_chance: { table: 'bets', rounds: 'rounds', select: TC_BET_SELECT },
  lucky_card: {
    table: 'lucky_card_bets', rounds: 'lucky_card_rounds',
    select: `round_id, ${LC_BET_COLUMNS.join(', ')}, total_stake, total_payout, is_settled, created_at,
             lucky_card_rounds!inner ( round_number, winning_rank, winning_suit, bonus_multiplier )`,
  },
  spin2win: {
    table: 'spin2win_bets', rounds: 'spin2win_rounds',
    select: `round_id, ${S2W_BET_COLUMNS.join(', ')}, total_stake, total_payout, is_settled, created_at,
             spin2win_rounds!inner ( round_number, winning_number, bonus_multiplier )`,
  },
  lucky16: {
    table: 'lucky16_bets', rounds: 'lucky16_rounds',
    select: `round_id, ${L16_BET_COLUMNS.join(', ')}, total_stake, total_payout, is_settled, created_at,
             lucky16_rounds!inner ( round_number, winning_rank, winning_suit, bonus_multiplier )`,
  },
}

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient
}

/** Plays, coins bet and coins won per game for `range` (whole IST days; null = lifetime). */
export async function fetchPlayerGameStats(playerId: string, range: DayRange | null): Promise<MoneyByGame> {
  const w = range ? rangeToInstants(range) : { from: null, to: null }
  const { data, error } = await db().rpc('staff_player_money_summary', { p_user_id: playerId, p_from: w.from, p_to: w.to })
  if (error) throw new Error(`player totals: ${error.message}`)
  return readByGameFrom(data)
}

/** One page of one game's plays (newest first) and the total for the filter. */
export async function fetchPlayerGamePlays(
  playerId: string,
  game: GameKey,
  opts: { range: DayRange | null; outcome: HistoryOutcome; round: number | null; page: number }
): Promise<{ plays: PlayerHistoryPlay[]; total: number }> {
  const src = SOURCES[game]
  let q = db().from(src.table).select(src.select, { count: 'exact' }).eq('user_id', playerId)
  if (opts.range) {
    const w = rangeToInstants(opts.range)
    q = q.gte('created_at', w.from).lte('created_at', w.to)
  }
  if (opts.outcome === 'WON') q = q.gt('total_payout', 0)
  if (opts.outcome === 'LOST') q = q.eq('is_settled', true).eq('total_payout', 0)
  if (opts.round !== null) q = q.eq(`${src.rounds}.round_number`, opts.round)
  const from = (opts.page - 1) * HISTORY_PAGE_SIZE
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(from, from + HISTORY_PAGE_SIZE - 1)
  if (error) throw new Error(`${game} plays: ${error.message}`)

  const rows = (data ?? []) as unknown[]
  const plays: PlayerHistoryPlay[] = rows.map((r) => {
    switch (game) {
      case 'triple_chance': return { game, play: shapeTripleChanceBet(r as TripleChanceBetRow) }
      case 'lucky_card': return { game, play: shapeLuckyCard(r as PlayerLuckyCardBetRow, istDateTime) }
      case 'spin2win': return { game, play: shapeSpin2Win(r as PlayerSpin2WinBetRow, istDateTime) }
      case 'lucky16': return { game, play: shapeLucky16(r as PlayerLucky16BetRow, istDateTime) }
    }
  })
  return { plays, total: count ?? plays.length }
}

/** One India day of a player's play (all games together), for the P&L Audit tab. */
export interface PlayerPnlDay {
  /** The IST day, 'YYYY-MM-DD'. */
  day: string
  plays: number
  stake: number
  payout: number
}

/**
 * The player's plays, coins bet and coins won per IST day for `range` (whole IST
 * days; null = lifetime), newest first, only days with plays. Added up by the
 * database (staff_player_daily_money), so nothing is capped.
 */
export async function fetchPlayerPnlDays(playerId: string, range: DayRange | null): Promise<PlayerPnlDay[]> {
  const w = range ? rangeToInstants(range) : { from: null, to: null }
  const { data, error } = await db().rpc('staff_player_daily_money', { p_user_id: playerId, p_from: w.from, p_to: w.to })
  if (error) throw new Error(`player days: ${error.message}`)
  return ((data ?? []) as Array<{ day: string; plays: unknown; stake: unknown; payout: unknown }>).map((r) => ({
    day: String(r.day).slice(0, 10),
    plays: Number(r.plays ?? 0),
    stake: Number(r.stake ?? 0),
    payout: Number(r.payout ?? 0),
  }))
}
