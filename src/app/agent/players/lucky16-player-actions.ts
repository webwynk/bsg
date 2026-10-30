'use server'

import { requireAuth } from '@/lib/auth-guard'
import type { PlayerLucky16Play } from '@/lib/lucky16'
import { runPlayerLucky16History } from './lucky16-player-history'

/**
 * Lucky 16 Card -- one player's Lucky 16 Card plays (last 100), for the agent players
 * page and the superadmin agent page. Callable by an agent (own players only)
 * and by a superadmin (anyone's); the ownership rule lives in
 * runPlayerLucky16History. One requireAuth() round-trip (RULE #20). The pages
 * call this only while the Lucky 16 Card side of the Game Plays tab is open, so
 * the other games' sides are unchanged. Read-only.
 */
export async function getPlayerLucky16HistoryAction(playerIdentifier: string): Promise<{
  plays: PlayerLucky16Play[]
  error: string | null
}> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { plays: [], error: auth.error }
  return runPlayerLucky16History(auth.user, playerIdentifier)
}
