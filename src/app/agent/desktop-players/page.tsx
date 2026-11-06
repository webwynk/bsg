"use client"

import { DesktopPlayersScreen } from '@/components/desktop-players-screen'
import type { DesktopPlayerRow } from '@/lib/desktop-players'
import { getAgentDesktopPlayersAction } from './actions'

/** The player's own page in the agent portal, which opens from its address. */
function historyHref(player: DesktopPlayerRow): string {
  return `/agent/players/${encodeURIComponent(player.username)}`
}

/** Desktop Player tab for an agent: their own players, Print shown view only. */
export default function AgentDesktopPlayersPage() {
  return <DesktopPlayersScreen fetchPlayers={getAgentDesktopPlayersAction} historyHref={historyHref} showAgent={false} />
}
