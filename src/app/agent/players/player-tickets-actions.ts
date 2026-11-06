'use server'

import { createAdminClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { asRpc } from '@/lib/rpc'
import { loadPlayerTickets, type PlayerTicket, type TicketGame, type TicketsByRound } from '@/lib/player-tickets'
import { assertOwnership, resolvePlayerId } from './players-shared'

/**
 * One player's printed tickets for the rounds on screen, for the agent players
 * page and the superadmin agent page. An agent reaches only their own players;
 * loadPlayerTickets runs that check before the read. Each win comes from the
 * database, through print_staff_tickets, which only the service key can run.
 * Called when the rounds on screen change, not on every poll. Read-only.
 */
export async function getPlayerTicketsAction(
  playerIdentifier: string,
  game: TicketGame,
  rounds: number[],
): Promise<{ tickets: TicketsByRound; error: string | null }> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { tickets: {}, error: auth.error }

  return loadPlayerTickets(auth.user, playerIdentifier, game, rounds, {
    resolvePlayerId,
    assertOwnership,
    readTickets: async (playerId, ticketGame, wanted) => {
      const { data, error } = await createAdminClient().rpc('print_staff_tickets', {
        p_user_id: playerId,
        p_game: ticketGame,
        p_round_numbers: wanted,
      })
      if (error) throw new Error(error.message)
      return asRpc<PlayerTicket[]>(data)
    },
  })
}
