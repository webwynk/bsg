import { createAdminClient } from '@/lib/supabase'

/**
 * Issue #93: split out of actions.ts (a 'use server' file) into its own
 * plain module so it can be imported by player-history-logic.ts and the
 * commission actions without creating a circular import with
 * superadmin/agents/actions.ts. (profit-report-logic.ts, its other early user,
 * was removed on 2026-11-08 with the old agent P&L page.)
 */
export async function resolveAgentId(identifier: string): Promise<string | null> {
  if (!identifier || identifier === 'all') return null
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)
  if (isUuid) return identifier
  const { data } = await createAdminClient()
    .from('profiles').select('id').eq('role', 'agent')
    .ilike('username', identifier).maybeSingle()
  return data?.id ?? null
}
