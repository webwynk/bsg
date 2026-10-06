'use server'

import { requireAuth } from '@/lib/auth-guard'
import type { PlayerLuckyCardPlay } from '@/lib/lucky-card'
import { runPlayerLuckyCardHistory } from './lucky-card-player-history'

/**
 * Lucky Card -- one player's Lucky Card plays (last 100), for the agent players
 * page and the superadmin agent page. Callable by an agent (own players only)
 * and by a superadmin (anyone's); the ownership rule lives in
 * runPlayerLuckyCardHistory. One requireAuth() round-trip (RULE #20). The pages
 * call this only while the Lucky Card side of the Game Plays tab is open, so
 * the Triple Chance side is unchanged (spec 17AT).
 */
export async function getPlayerLuckyCardHistoryAction(playerIdentifier: string): Promise<{
  plays: PlayerLuckyCardPlay[]
  error: string | null
}> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { plays: [], error: auth.error }
  return runPlayerLuckyCardHistory(auth.user, playerIdentifier)
}
