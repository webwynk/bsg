'use server'

import { requireAuth } from '@/lib/auth-guard'
import { rangeProblem, type DayRange } from '@/lib/gameplay-range'
import { EMPTY_COMMISSION_REPORT, parseRatePct, type CommissionReport } from '@/lib/agent-commission'
import { resolveAgentId } from './resolve-agent-id'
import {
  fetchCommissionAgent, fetchCommissionHistory, fetchCommissionReport, saveCommissionRate,
  type CommissionAgent, type CommissionHistoryRow,
} from './agent-commission-data'

/**
 * Agent commission (2026-11-08; plan docs/AGENT_COMMISSION_PLAN.md).
 *
 * - The superadmin reads any agent's report and history and sets the %.
 * - An agent reads ONLY their own report (the identifier they pass is ignored:
 *   their own id is always used), and can't read the history or set the %.
 * - Players can't call any of it (requireAuth).
 * The database functions are service-role only and re-check the superadmin on
 * every change, so these checks are the first of two locks, not the only one.
 */

type Who = { agentId: string } | { error: string }

/** Which agent the caller may see: a superadmin any agent by username/id, an agent only themselves. */
async function allowedAgent(identifier: string | null, roles: Array<'superadmin' | 'agent'>): Promise<Who & { actorId?: string }> {
  const auth = await requireAuth(roles)
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }
  if (auth.user.role === 'agent') return { agentId: auth.user.id, actorId: auth.user.id }
  const agentId = identifier ? await resolveAgentId(identifier) : null
  if (!agentId) return { error: 'Agent not found.' }
  return { agentId, actorId: auth.user.id }
}

const message = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error')

/** The agent's Bets, Wins, P&L, commission and the agent's name/ID for `range` (IST days; null = lifetime). */
export async function getAgentCommissionReportAction(
  agentIdentifier: string | null,
  range: DayRange | null
): Promise<{ report: CommissionReport; agent: CommissionAgent | null; error: string | null }> {
  const who = await allowedAgent(agentIdentifier, ['superadmin', 'agent'])
  if ('error' in who) return { report: EMPTY_COMMISSION_REPORT, agent: null, error: who.error }
  const problem = range === null ? null : rangeProblem(range, new Date())
  if (problem) return { report: EMPTY_COMMISSION_REPORT, agent: null, error: problem }
  try {
    const agent = await fetchCommissionAgent(who.agentId)
    if (!agent) return { report: EMPTY_COMMISSION_REPORT, agent: null, error: 'Agent not found.' }
    return { report: await fetchCommissionReport(who.agentId, range), agent, error: null }
  } catch (err) {
    return { report: EMPTY_COMMISSION_REPORT, agent: null, error: `Could not load the commission report: ${message(err)}` }
  }
}

/** The latest % changes for the Edit dialog (superadmin only). */
export async function getAgentCommissionHistoryAction(
  agentIdentifier: string
): Promise<{ history: CommissionHistoryRow[]; error: string | null }> {
  const who = await allowedAgent(agentIdentifier, ['superadmin'])
  if ('error' in who) return { history: [], error: who.error }
  try {
    return { history: await fetchCommissionHistory(who.agentId, 5), error: null }
  } catch (err) {
    return { history: [], error: `Could not load the commission history: ${message(err)}` }
  }
}

/** Sets the agent's % from today (IST). Superadmin only; logged in the audit log by the database. */
export async function setAgentCommissionAction(
  agentIdentifier: string,
  pctInput: string
): Promise<{ ok: boolean; changed: boolean; newPct: number; effectiveFrom: string; error: string | null }> {
  const fail = (error: string) => ({ ok: false, changed: false, newPct: 0, effectiveFrom: '', error })
  const who = await allowedAgent(agentIdentifier, ['superadmin'])
  if ('error' in who || !who.actorId) return fail('error' in who ? who.error : 'Unauthorized')
  const parsed = parseRatePct(pctInput)
  if ('error' in parsed) return fail(parsed.error)
  try {
    const res = await saveCommissionRate(who.actorId, who.agentId, parsed.pct)
    return { ok: true, changed: res.changed, newPct: res.newPct, effectiveFrom: res.effectiveFrom, error: null }
  } catch (err) {
    return fail(`Could not save the commission: ${message(err)}`)
  }
}
