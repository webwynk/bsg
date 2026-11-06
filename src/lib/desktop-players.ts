/**
 * Shared rules for the Desktop Player tab. No database access here, so the
 * wording and the search cleaning can be tested on their own.
 */

export const DESKTOP_PLAYERS_PER_PAGE = 50

export type PrintFilter = 'all' | 'on' | 'off'

/** One row of the tab: the player list's fields, plus agent and Print. */
export interface DesktopPlayerRow {
  id: string
  full_name: string
  username: string
  account_code: string | null
  coin_balance: number
  is_active: boolean
  is_online: boolean
  auto_locked_at: string | null
  agent_name: string | null
  /** Null when the player has no agent, so there is no history page to open. */
  agent_username: string | null
  print_enabled: boolean
}

export interface DesktopPlayerCounts {
  all: number
  on: number
  off: number
}

export interface DesktopPlayersParams {
  search?: string
  filter: PrintFilter
  page: number
}

export interface DesktopPlayersResult {
  rows: DesktopPlayerRow[]
  total: number
  counts: DesktopPlayerCounts
  error: string | null
}

/**
 * Limits a profiles query to one agent's players. Every player read for an
 * agent goes through here, so an agent can never see another agent's players.
 * Null is the superadmin, who sees all.
 */
export function scopeToAgent<Query extends { eq(column: 'agent_id', value: string): Query }>(
  query: Query,
  agentId: string | null,
): Query {
  return agentId ? query.eq('agent_id', agentId) : query
}

/**
 * Keeps letters, numbers and the characters usernames and names use. The term
 * goes inside a PostgREST filter, where a comma, bracket or quote has meaning.
 */
export function cleanDesktopSearch(input: string | undefined): string {
  return (input ?? '').replace(/[^\p{L}\p{M}\p{N} _.@-]/gu, '').trim().slice(0, 50)
}

/** Screen wording for a refusal from set_print_enabled, by Postgres error code. */
export function printSwitchError(code: string | undefined, username: string): string {
  switch (code) {
    case 'P0156':
      return `Too soon. Print for @${username} changed less than 103 seconds ago. Please try again in a moment.`
    case 'P0151':
      return `@${username} has no player ID yet, so Print can not be turned on.`
    case 'P0150':
      return `@${username} is not a player account.`
    case 'P0135':
      return 'Only the superadmin can change Print.'
    default:
      return `Could not change Print for @${username}. Please try again.`
  }
}
