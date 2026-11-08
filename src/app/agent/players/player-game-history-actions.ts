'use server'

import { requireAuth } from '@/lib/auth-guard'
import { EMPTY_MONEY_BY_GAME, GAMES, type GameKey, type MoneyByGame } from '@/lib/money-totals-logic'
import { rangeProblem, type DayRange } from '@/lib/gameplay-range'
import { isHistoryOutcome, parseRoundSearch, safePage, type HistoryOutcome } from '@/lib/player-history-filter'
import { resolvePlayerId, assertOwnership } from './players-shared'
import { fetchPlayerGamePlays, fetchPlayerGameStats, fetchPlayerPnlDays, type PlayerHistoryPlay, type PlayerPnlDay } from './player-game-history'

/**
 * Player History page (superadmin + agent): the calls behind
 * components/player-game-history.tsx (figures and plays) and the superadmin
 * page's P&L Audit tab (components/player-pnl-audit.tsx, days). All check the login (agent or
 * superadmin) and that an agent only reads their own players (assertOwnership,
 * the same rule as every other player action). Read-only.
 */

async function authorizedPlayer(playerIdentifier: string): Promise<{ playerId: string } | { error: string }> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }
  const playerId = await resolvePlayerId(playerIdentifier)
  if (!playerId) return { error: 'Player not found.' }
  const owned = await assertOwnership(auth.user, playerId)
  if (!owned.ok) return { error: owned.error }
  return { playerId }
}

function checkRange(range: DayRange | null): string | null {
  return range === null ? null : rangeProblem(range, new Date())
}

/** The player's plays, coins bet and coins won per game for `range` (IST days; null = lifetime). */
export async function getPlayerGameStatsAction(
  playerIdentifier: string,
  range: DayRange | null
): Promise<{ games: MoneyByGame; error: string | null }> {
  const who = await authorizedPlayer(playerIdentifier)
  if ('error' in who) return { games: EMPTY_MONEY_BY_GAME, error: who.error }
  const problem = checkRange(range)
  if (problem) return { games: EMPTY_MONEY_BY_GAME, error: problem }
  try {
    return { games: await fetchPlayerGameStats(who.playerId, range), error: null }
  } catch (err) {
    return { games: EMPTY_MONEY_BY_GAME, error: `Could not load the player's figures: ${err instanceof Error ? err.message : 'Unknown error'}` }
  }
}

/** One page of one game's plays for the filters, newest first, with the total count. */
export async function getPlayerGamePlaysAction(
  playerIdentifier: string,
  game: GameKey,
  filters: { range: DayRange | null; outcome: HistoryOutcome; roundSearch: string; page: number }
): Promise<{ plays: PlayerHistoryPlay[]; total: number; error: string | null }> {
  const who = await authorizedPlayer(playerIdentifier)
  if ('error' in who) return { plays: [], total: 0, error: who.error }
  if (!GAMES.some((g) => g.key === game)) return { plays: [], total: 0, error: 'Unknown game.' }
  const problem = checkRange(filters.range)
  if (problem) return { plays: [], total: 0, error: problem }
  const round = parseRoundSearch(filters.roundSearch ?? '')
  if (round === 'invalid') return { plays: [], total: 0, error: 'Type a round ID like TC-17418073 or just the number.' }
  const outcome = isHistoryOutcome(filters.outcome) ? filters.outcome : 'all'
  try {
    const res = await fetchPlayerGamePlays(who.playerId, game, { range: filters.range, outcome, round, page: safePage(filters.page) })
    return { ...res, error: null }
  } catch (err) {
    return { plays: [], total: 0, error: `Could not load the plays: ${err instanceof Error ? err.message : 'Unknown error'}` }
  }
}

/** The player's P&L per IST day for `range` (null = lifetime), newest first. */
export async function getPlayerPnlDaysAction(
  playerIdentifier: string,
  range: DayRange | null
): Promise<{ days: PlayerPnlDay[]; error: string | null }> {
  const who = await authorizedPlayer(playerIdentifier)
  if ('error' in who) return { days: [], error: who.error }
  const problem = checkRange(range)
  if (problem) return { days: [], error: problem }
  try {
    return { days: await fetchPlayerPnlDays(who.playerId, range), error: null }
  } catch (err) {
    return { days: [], error: `Could not load the player's P&L: ${err instanceof Error ? err.message : 'Unknown error'}` }
  }
}
