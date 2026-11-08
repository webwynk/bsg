import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import { fetchAccountCodes } from '@/lib/account-codes'
import { rangeToInstants, type DayRange } from '@/lib/gameplay-range'
import { readCommissionReport, type CommissionReport } from '@/lib/agent-commission'

/**
 * Agent commission: the database calls behind agent-commission-actions.ts
 * (migration 20261108120000_agent_commission.sql). Server-only and
 * deliberately NOT a 'use server' file: it uses the service-role client and
 * trusts its caller, so only actions that already passed requireAuth() and
 * decided WHICH agent the caller may see call it.
 *
 * Untyped client on purpose: database.types.ts does not know these functions
 * (same as money-totals.ts); the answers are checked by readCommissionReport.
 */

export interface CommissionAgent {
  id: string
  username: string
  fullName: string
  accountCode: string | null
}

export interface CommissionHistoryRow {
  effectiveFrom: string
  ratePct: number
  setBy: string | null
  updatedAt: string
}

const db = () => createAdminClient() as unknown as SupabaseClient

/** The agent's name, username and ID code, or null when the id is not an agent. */
export async function fetchCommissionAgent(agentId: string): Promise<CommissionAgent | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('profiles').select('id, username, full_name, role').eq('id', agentId).maybeSingle()
  if (error) throw new Error(`agent: ${error.message}`)
  if (!data || data.role !== 'agent') return null
  const codes = await fetchAccountCodes(admin, [agentId])
  return { id: data.id, username: data.username, fullName: data.full_name || data.username, accountCode: codes.get(agentId) ?? null }
}

/** Bets, wins and commission of the agent's players for `range` (IST days; null = lifetime). */
export async function fetchCommissionReport(agentId: string, range: DayRange | null): Promise<CommissionReport> {
  const w = range ? rangeToInstants(range) : { from: null, to: null }
  const { data, error } = await db().rpc('staff_agent_commission_report', { p_agent_id: agentId, p_from: w.from, p_to: w.to })
  if (error) throw new Error(`commission report: ${error.message}`)
  return readCommissionReport(data)
}

/** The latest % changes (newest first) with who made them. */
export async function fetchCommissionHistory(agentId: string, limit = 5): Promise<CommissionHistoryRow[]> {
  const { data, error } = await db().rpc('staff_agent_commission_history', { p_agent_id: agentId, p_limit: limit })
  if (error) throw new Error(`commission history: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    effectiveFrom: String(r.effective_from ?? '').slice(0, 10),
    ratePct: Number(r.rate_pct ?? 0),
    setBy: r.set_by_username ? String(r.set_by_username) : null,
    updatedAt: String(r.updated_at ?? ''),
  }))
}

/**
 * Sets the agent's % from today (IST). The database re-checks that the actor is
 * an active superadmin, validates the %, and writes the audit_log row in the
 * same transaction. Returns the database's error message in plain words.
 */
export async function saveCommissionRate(actorId: string, agentId: string, pct: number): Promise<{ changed: boolean; oldPct: number; newPct: number; effectiveFrom: string }> {
  const { data, error } = await db().rpc('set_agent_commission', { p_actor_id: actorId, p_agent_id: agentId, p_rate_pct: pct })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Record<string, unknown>
  return { changed: r.changed === true, oldPct: Number(r.old_pct ?? 0), newPct: Number(r.new_pct ?? pct), effectiveFrom: String(r.effective_from ?? '').slice(0, 10) }
}
