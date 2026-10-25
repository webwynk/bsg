'use server'

import { requireAuth } from '@/lib/auth-guard'
import type { PlayerSpin2WinPlay } from '@/lib/spin2win'
import { runPlayerSpin2WinHistory } from './spin2win-player-history'

/**
 * Spin2Win -- one player's Spin2Win plays (last 100), for the agent players
 * page and the superadmin agent page. Callable by an agent (own players only)
 * and by a superadmin (anyone's); the ownership rule lives in
 * runPlayerSpin2WinHistory. One requireAuth() round-trip (RULE #20). Read-only.
 * The pages call this only while the Spin2Win side of the Game Plays tab is
 * open, so the other games' sides are unchanged.
 */
export async function getPlayerSpin2WinHistoryAction(playerIdentifier: string): Promise<{
  plays: PlayerSpin2WinPlay[]
  error: string | null
}> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { plays: [], error: auth.error }
  return runPlayerSpin2WinHistory(auth.user, playerIdentifier)
}
