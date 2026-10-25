import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import {
  S2W_BET_COLUMNS,
  shapePlayerPlay,
  type PlayerSpin2WinBetRow,
  type PlayerSpin2WinPlay,
} from '@/lib/spin2win'
import { istDateTime, resolvePlayerId, assertOwnership } from './players-shared'

/**
 * Spin2Win -- a player's own game history, for the "Spin2Win" side of the Game
 * Plays tab on the agent players page and the superadmin agent page. Built the
 * same way as lucky-card-player-history.ts, in its own file so the Triple
 * Chance and Lucky Card histories cost and change nothing.
 *
 * Deliberately NOT exported from a 'use server' file: a function exported there
 * becomes directly callable as a Server Action, and this one trusts its
 * `caller` argument. This file has no directive, so it is plain server-only
 * code, reachable only through spin2win-player-actions.ts, which has already
 * verified the caller.
 *
 * The untyped client is on purpose (spec 17AO): database.types.ts has no
 * spin2win_* object, so a client typed against it would not compile for these
 * tables.
 */

/** The same size as the other games' lists: the player's last 100 bets. */
const PLAY_LIMIT = 100

export async function runPlayerSpin2WinHistory(
  caller: { id: string; role: string },
  playerIdentifier: string
): Promise<{ plays: PlayerSpin2WinPlay[]; error: string | null }> {
  try {
    const playerId = await resolvePlayerId(playerIdentifier)
    if (!playerId) return { plays: [], error: 'Player not found.' }

    // An agent may only see their own players; a superadmin anyone's.
    const owned = await assertOwnership(caller, playerId)
    if (!owned.ok) return { plays: [], error: owned.error }

    const db = createAdminClient() as unknown as SupabaseClient
    // spin2win_rounds!inner: a bet always has its round (foreign key), the
    // inner join just makes that explicit. idx_spin2win_bets_user
    // (user_id, created_at DESC) makes this a short index read.
    const { data, error } = await db
      .from('spin2win_bets')
      .select(`round_id, ${S2W_BET_COLUMNS.join(', ')}, total_stake, total_payout, is_settled, created_at,
               spin2win_rounds!inner ( round_number, winning_number, bonus_multiplier )`)
      .eq('user_id', playerId)
      .order('created_at', { ascending: false })
      .limit(PLAY_LIMIT)
    if (error) throw new Error(`spin2win bets: ${error.message}`)

    const rows = (data ?? []) as unknown as PlayerSpin2WinBetRow[]
    return { plays: rows.map(r => shapePlayerPlay(r, istDateTime)), error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { plays: [], error: `Could not load Spin2Win history: ${message}` }
  }
}
