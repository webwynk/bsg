import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import {
  LC_BET_COLUMNS,
  shapePlayerPlay,
  type PlayerLuckyCardBetRow,
  type PlayerLuckyCardPlay,
} from '@/lib/lucky-card'
import { istDateTime, resolvePlayerId, assertOwnership } from './players-shared'

/**
 * Lucky Card -- a player's own game history, for the "Lucky Card" side of the
 * Game Plays tab on the agent players page and the superadmin agent page. The
 * Lucky Card counterpart of player-history-logic.ts (Triple Chance), which is
 * left untouched: this is its own file so the Triple Chance history, its
 * 3-second refresh and its data shapes cost and change nothing.
 *
 * Like runPlayerDetailHistory, this is deliberately NOT exported from a 'use
 * server' file: a function exported there becomes directly callable as a Server
 * Action, and this one trusts its `caller` argument. This file has no
 * directive, so it is plain server-only code, reachable only through
 * lucky-card-player-actions.ts, which has already verified the caller.
 *
 * The untyped client is on purpose (spec 17AO): database.types.ts has no
 * lucky_card_* object yet, so a client typed against it would not compile for
 * these tables. A real-database test of this query stands in for that check.
 */

/** The same size as Triple Chance's list: the player's last 100 bets. */
const PLAY_LIMIT = 100

export async function runPlayerLuckyCardHistory(
  caller: { id: string; role: string },
  playerIdentifier: string
): Promise<{ plays: PlayerLuckyCardPlay[]; error: string | null }> {
  try {
    const playerId = await resolvePlayerId(playerIdentifier)
    if (!playerId) return { plays: [], error: 'Player not found.' }

    // An agent may only see their own players; a superadmin anyone's.
    const owned = await assertOwnership(caller, playerId)
    if (!owned.ok) return { plays: [], error: owned.error }

    const db = createAdminClient() as unknown as SupabaseClient
    // lucky_card_rounds!inner: a bet always has its round (foreign key), the
    // inner join just makes that explicit. The (player, newest first) index
    // makes this a short index read, not a table scan.
    const { data, error } = await db
      .from('lucky_card_bets')
      .select(`round_id, ${LC_BET_COLUMNS.join(', ')}, total_stake, total_payout, is_settled, created_at,
               lucky_card_rounds!inner ( round_number, winning_rank, winning_suit, bonus_multiplier )`)
      .eq('user_id', playerId)
      .order('created_at', { ascending: false })
      .limit(PLAY_LIMIT)
    if (error) throw new Error(`lucky card bets: ${error.message}`)

    const rows = (data ?? []) as unknown as PlayerLuckyCardBetRow[]
    return { plays: rows.map(r => shapePlayerPlay(r, istDateTime)), error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { plays: [], error: `Could not load Lucky Card history: ${message}` }
  }
}
