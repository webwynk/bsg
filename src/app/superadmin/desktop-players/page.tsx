"use client"

import { DesktopPlayersScreen } from '@/components/desktop-players-screen'
import type { DesktopPlayerRow } from '@/lib/desktop-players'
import { getDesktopPlayersAction, setPlayerPrintAction } from './actions'

/** The history page of a player, opened on that player under their agent. */
function historyHref(player: DesktopPlayerRow): string | null {
  if (!player.agent_username) return null
  return `/superadmin/agents/${encodeURIComponent(player.agent_username)}?player=${encodeURIComponent(player.username)}`
}

/** Desktop Player tab for the superadmin: every player, and the only Print switch. */
export default function DesktopPlayersPage() {
  return <DesktopPlayersScreen fetchPlayers={getDesktopPlayersAction} historyHref={historyHref} setPrint={setPlayerPrintAction} />
}
