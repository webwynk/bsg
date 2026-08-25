import { createAdminClient } from '@/lib/supabase'
import { CASHIER_KINDS, isCredit, ledgerKindLabel, type LedgerKind } from '@/lib/ledger'
import { istDateTime, resolvePlayerId, assertOwnership } from './players-shared'
import type { PlayerGamePlay, PlayerCoinMovement } from './actions'

/**
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
  game_plays: PlayerGamePlay[]
  coin_movements: PlayerCoinMovement[]
  error: string | null
}> {
  try {
    const playerId = await resolvePlayerId(playerIdentifier)
    if (!playerId) return { game_plays: [], coin_movements: [], error: 'Player not found.' }

    const owned = await assertOwnership(caller, playerId)
    if (!owned.ok) return { game_plays: [], coin_movements: [], error: owned.error }

    const db = createAdminClient()

    // A real foreign key now exists, so a single embedded select is safe.
    // v1 needed a two-step fetch-and-merge because the join silently dropped
    // rows; the payout no longer has to be recomputed client-side either --
    // settle_round() writes the authoritative figures.
    const [betsRes, ledgerRes] = await Promise.all([
      db.from('bets')
        .select(`id, round_id, single_bets, double_bets, triple_bets,
                 total_stake, total_payout, is_settled, created_at,
                 rounds!inner ( round_number, red, green, black )`)
        .eq('user_id', playerId)
        .order('created_at', { ascending: false })
        .limit(100),
      // Cashier kinds only -- gameplay (stake/stake_refund/payout) is already
      // covered above by the bets query, one row per round with the actual
      // WON/LOST outcome, which is strictly more useful than the raw
      // stake/payout ledger split. This "Coins History" list exists to show
      // agent<->player cashier transfers specifically.
      db.from('coin_ledger')
        .select('id, kind, amount, balance_after, created_at')
        .eq('user_id', playerId)
        .in('kind', CASHIER_KINDS as unknown as string[])
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    if (betsRes.error) throw new Error(`bets: ${betsRes.error.message}`)
    if (ledgerRes.error) throw new Error(`ledger: ${ledgerRes.error.message}`)

    const game_plays: PlayerGamePlay[] = (betsRes.data ?? []).map(b => {
      const round = (b as unknown as { rounds: { round_number: number; red: number | null; green: number | null; black: number | null } }).rounds
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
        // Full round UUID as Hand ID -- displayed in full in the dashboard
        // detail popup per explicit user requirement.
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
      }
    })

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

    return { game_plays, coin_movements, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { game_plays: [], coin_movements: [], error: `Could not load history: ${message}` }
  }
}
