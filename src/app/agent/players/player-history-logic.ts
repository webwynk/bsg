import { createAdminClient } from '@/lib/supabase'
import { CASHIER_KINDS, isCredit, ledgerKindLabel, type LedgerKind } from '@/lib/ledger'
import { istDateTime, resolvePlayerId, assertOwnership } from './players-shared'
import type { PlayerGamePlay, PlayerCoinMovement } from './actions'

/** The columns a Triple Chance bet row is read with (bets + its round). */
export const TC_BET_SELECT = `id, round_id, single_bets, double_bets, triple_bets,
                 total_stake, total_payout, is_settled, created_at,
                 rounds!inner ( round_number, red, green, black, bonus_multiplier )`

/** One Triple Chance bet row as read with TC_BET_SELECT. */
export interface TripleChanceBetRow {
  round_id: string
  single_bets: unknown
  double_bets: unknown
  triple_bets: unknown
  total_stake: number | string | null
  total_payout: number | string | null
  is_settled: boolean | null
  created_at: string
  rounds: { round_number: number; red: number | null; green: number | null; black: number | null; bonus_multiplier: number }
}

/**
 * One bets row -> one row of the player's Triple Chance history, used by the
 * paged Player History query (player-game-history.ts). Outcome: WON when
 * anything was paid, else LOST.
 */
export function shapeTripleChanceBet(b: TripleChanceBetRow): PlayerGamePlay {
  const round = b.rounds
  const single = (b.single_bets ?? {}) as Record<string, number>
  const dbl    = (b.double_bets ?? {}) as Record<string, number>
  const triple = (b.triple_bets ?? {}) as Record<string, number>

  const modes: string[] = []
  if (Object.keys(single).length) modes.push('SINGLE')
  if (Object.keys(dbl).length)    modes.push('DOUBLE')
  if (Object.keys(triple).length) modes.push('TRIPLE')

  const parts: string[] = []
  if (Object.keys(single).length) parts.push(`Single: ${Object.keys(single).join(',')}`)
  if (Object.keys(dbl).length)    parts.push(`Double: ${Object.keys(dbl).join(',')}`)
  if (Object.keys(triple).length) parts.push(`Triple: ${Object.keys(triple).join(',')}`)

  const drawn = round.red !== null && round.green !== null && round.black !== null
  const payout = Number(b.total_payout ?? 0)

  return {
    // The round's own id: a row key only. Screens show roundId().
    hand_id: String(b.round_id),
    round_number: Number(round.round_number),
    mode: modes.join(' + ') || 'TRIPLE CHANCE',
    selections: parts.join(' | ') || 'Multi-board bet',
    result: drawn ? `${round.red} . ${round.green} . ${round.black}` : '—',
    total_stake: Number(b.total_stake ?? 0),
    total_payout: payout,
    outcome: payout > 0 ? 'WON' : 'LOST',
    is_settled: Boolean(b.is_settled),
    created_at: istDateTime(b.created_at),
    created_at_iso: b.created_at,
    single_bets: single,
    double_bets: dbl,
    triple_bets: triple,
    red: round.red,
    green: round.green,
    black: round.black,
    // Issue #100: this round's own pinned bonus multiplier (1/2/3/4 = N/2X/3X/4X).
    bonus_multiplier: Number(round.bonus_multiplier),
  }
}

/**
 * The player's Coins History (agent <-> player cashier movements). Since the
 * 2026-11-07 Player History redesign the game plays are no longer loaded here:
 * components/player-game-history.tsx asks for them per game, paged and filtered
 * (player-game-history.ts), instead of "the last 100 Triple Chance plays".
 *
 * Issue #93: core player-history logic, extracted out of the 'use server'
 * getPlayerDetailHistoryAction so it can also be called, already-authorized,
 * from getPlayersWithHistoryAction (this directory) and
 * getAgentDetailBundleAction (superadmin/agents/actions.ts) without a second
 * requireAuth() round-trip each. Deliberately NOT exported from a 'use
 * server' file: doing so would make it directly callable as its own Server
 * Action, bypassing requireAuth() entirely for a caller who forges the
 * `caller` argument -- this file has no directive, so it is plain
 * server-only code, reachable only through callers that have already
 * verified `caller` themselves via requireAuth().
 */
export async function runPlayerDetailHistory(
  caller: { id: string; role: string },
  playerIdentifier: string
): Promise<{
  coin_movements: PlayerCoinMovement[]
  error: string | null
}> {
  try {
    const playerId = await resolvePlayerId(playerIdentifier)
    if (!playerId) return { coin_movements: [], error: 'Player not found.' }

    const owned = await assertOwnership(caller, playerId)
    if (!owned.ok) return { coin_movements: [], error: owned.error }

    const db = createAdminClient()

    const [ledgerRes] = await Promise.all([
      // Cashier kinds only -- gameplay (stake/stake_refund/payout) is shown per
      // round by the Player History game lists, with the actual WON/LOST
      // outcome. This "Coins History" list exists to show agent<->player
      // cashier transfers specifically.
      db.from('coin_ledger')
        .select('id, kind, amount, balance_after, created_at')
        .eq('user_id', playerId)
        .in('kind', CASHIER_KINDS as unknown as string[])
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    if (ledgerRes.error) throw new Error(`ledger: ${ledgerRes.error.message}`)

    const coin_movements: PlayerCoinMovement[] = (ledgerRes.data ?? []).map(row => ({
      id: row.id,
      kind: row.kind as LedgerKind,
      label: ledgerKindLabel(row.kind),
      direction: isCredit(Number(row.amount)) ? 'deposit' : 'withdraw',
      amount: Math.abs(Number(row.amount)),
      balance_after: Number(row.balance_after),
      created_at: istDateTime(row.created_at),
      created_at_iso: row.created_at,
    }))

    return { coin_movements, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { coin_movements: [], error: `Could not load history: ${message}` }
  }
}
