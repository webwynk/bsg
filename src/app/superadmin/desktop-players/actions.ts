'use server'

import { createClient as createUserClient, createAdminClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { runDesktopPlayers } from '@/lib/desktop-players-query'
import { printSwitchError, type DesktopPlayersParams, type DesktopPlayersResult } from '@/lib/desktop-players'

/** Every player, for the Desktop Player tab. */
export async function getDesktopPlayersAction(params: DesktopPlayersParams): Promise<DesktopPlayersResult> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) {
    return { rows: [], total: 0, counts: { all: 0, on: 0, off: 0 }, error: auth.error }
  }
  return runDesktopPlayers(createAdminClient(), params, null)
}

/**
 * Turns Print on or off for one player, from each game's next round. Runs with
 * the superadmin's own session, never the service key: set_print_enabled reads
 * auth.uid() for its superadmin check and audit log, and also applies the
 * 103-second rule, so none of that is repeated here.
 */
export async function setPlayerPrintAction(
  playerId: string,
  username: string,
  enabled: boolean,
): Promise<{ error: string | null }> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { error: auth.error }

  try {
    const supabase = await createUserClient()
    const { error } = await supabase.rpc('set_print_enabled', { p_user_id: playerId, p_enabled: enabled })
    if (error) {
      console.error('setPlayerPrintAction:', error.code, error.message)
      return { error: printSwitchError(error.code, username) }
    }
    return { error: null }
  } catch (err) {
    console.error('setPlayerPrintAction:', err)
    return { error: printSwitchError(undefined, username) }
  }
}
