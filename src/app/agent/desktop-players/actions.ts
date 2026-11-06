'use server'

import { createAdminClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { runDesktopPlayers } from '@/lib/desktop-players-query'
import type { DesktopPlayersParams, DesktopPlayersResult } from '@/lib/desktop-players'

/**
 * The signed-in agent's own players for the Desktop Player tab. The agent id
 * comes only from the session, and the action takes no agent or player id, so a
 * browser can not ask for another agent's players.
 */
export async function getAgentDesktopPlayersAction(params: DesktopPlayersParams): Promise<DesktopPlayersResult> {
  const auth = await requireAuth(['agent'])
  if (auth.error || !auth.user) {
    return { rows: [], total: 0, counts: { all: 0, on: 0, off: 0 }, error: auth.error }
  }
  return runDesktopPlayers(createAdminClient(), params, auth.user.id)
}
