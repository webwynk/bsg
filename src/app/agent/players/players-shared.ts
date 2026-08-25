import { createAdminClient } from '@/lib/supabase'

/**
 * Small helpers shared across every action in this directory (list, create,
 * transfer, toggle-active, and the extracted player-history logic in
 * player-history-logic.ts). Kept in their own, non-'use server' module so
 * they can be imported by that logic file too without becoming Server
 * Actions themselves.
 */

export function istDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Resolves a username or UUID to a profile id, scoped to what the caller may see. */
export async function resolvePlayerId(identifier: string): Promise<string | null> {
  if (!identifier) return null
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)
  if (isUuid) return identifier
  const { data } = await createAdminClient().from('profiles').select('id').ilike('username', identifier).maybeSingle()
  return data?.id ?? null
}

/**
 * Confirms the caller may act on this player.
 * Superadmin may act on anyone; an agent only on their own players.
 */
export async function assertOwnership(
  caller: { id: string; role: string },
  playerId: string
): Promise<
  | { ok: true; player: { id: string; username: string; agent_id: string | null; auto_locked_at: string | null } }
  | { ok: false; error: string }
> {
  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('id, username, role, agent_id, auto_locked_at')
    .eq('id', playerId)
    .single()

  if (error || !data) return { ok: false, error: 'Player account not found.' }
  if (data.role !== 'player') return { ok: false, error: 'That account is not a player.' }
  if (caller.role === 'agent' && data.agent_id !== caller.id) {
    return { ok: false, error: 'Unauthorized: that player belongs to another agent.' }
  }
  return { ok: true, player: { id: data.id, username: data.username, agent_id: data.agent_id, auto_locked_at: data.auto_locked_at } }
}
