'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createUserClient, createAdminClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { asRpc, type AdminIssueResult, type SetAgentActiveResult } from '@/lib/rpc'
import { logAuditEventAction } from '../actions'
import { isCredit, toWholeCoins, type TransferDirection } from '@/lib/ledger'
import { USERNAME_PATTERN } from '@/lib/validation'
import { resolveAgentId } from './resolve-agent-id'
import { runAgentProfitReport, EMPTY_PROFIT_REPORT } from '@/app/agent/profit/profit-report-logic'
import { runPlayerDetailHistory } from '@/app/agent/players/player-history-logic'
import type { ProfitReportParams, ProfitReport } from '@/app/agent/profit/actions'
import type { PlayerGamePlay, PlayerCoinMovement } from '@/app/agent/players/actions'

/**
 * Agent administration — v2.
 *
 * Every export is guarded by requireAuth(['superadmin']). Coin movement goes
 * through the admin_issue_coins RPC using the CALLER'S session, so the database
 * identifies the actor from auth.uid(); the service-role client is used only
 * for reads and Auth admin operations already authorised here.
 *
 * M-1 carried forward: blocking an agent now writes profiles.is_active — the
 * column the heartbeat and every dashboard view actually read — and cascades in
 * BOTH directions. v1 wrote only auth metadata, so a blocked agent still showed
 * as Active and nobody was ever kicked out of a live session.
 */


function istDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────────────────
export interface AgentRow {
  id: string
  full_name: string
  username: string
  coin_balance: number
  is_active: boolean
  auto_locked_at: string | null
  player_count: number
}

export async function getAgentsAction(): Promise<{ agents: AgentRow[]; error: string | null }> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { agents: [], error: auth.error }

  try {
    const db = createAdminClient()
    const [agentsRes, playersRes] = await Promise.all([
      db.from('profiles')
        .select('id, username, full_name, coin_balance, is_active, auto_locked_at')
        .eq('role', 'agent').order('username'),
      db.from('profiles').select('agent_id').eq('role', 'player').range(0, 999999),
    ])
    if (agentsRes.error) throw new Error(agentsRes.error.message)
    if (playersRes.error) throw new Error(playersRes.error.message)

    const counts = new Map<string, number>()
    for (const p of playersRes.data ?? []) {
      if (p.agent_id) counts.set(p.agent_id, (counts.get(p.agent_id) ?? 0) + 1)
    }

    return {
      agents: (agentsRes.data ?? []).map(a => ({
        id: a.id,
        full_name: a.full_name || a.username,
        username: a.username,
        coin_balance: Number(a.coin_balance ?? 0),
        is_active: a.is_active,
        auto_locked_at: a.auto_locked_at,
        player_count: counts.get(a.id) ?? 0,
      })),
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { agents: [], error: `Could not load agents: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Issue #93: core agent-detail logic, private to this file (never exported
 * -- a 'use server' file may only export async functions that are themselves
 * safe to expose as Server Actions, and this one takes an already-resolved
 * agentId and does no authorization of its own). Takes agentId pre-resolved
 * rather than an identifier so getAgentDetailBundleAction below can resolve
 * it once and reuse it for the profit report too, instead of two separate
 * resolveAgentId round-trips for the same identifier.
 */
async function runAgentDetail(agentId: string) {
  try {
    const db = createAdminClient()
    const [agentRes, playersRes] = await Promise.all([
      db.from('profiles')
        .select('id, username, full_name, coin_balance, is_active, auto_locked_at, created_at')
        .eq('id', agentId).single(),
      db.from('profiles')
        .select('id, username, full_name, coin_balance, is_active, auto_locked_at')
        .eq('agent_id', agentId).order('username'),
    ])
    if (agentRes.error) throw new Error(agentRes.error.message)
    if (playersRes.error) throw new Error(playersRes.error.message)

    // Scoped to this agent's own players, not a full-table scan (was
    // previously unfiltered -- fetched every session on the platform just to
    // compute a handful of online/offline dots). Player IDs aren't known
    // until playersRes resolves, so this runs after the Promise.all above
    // rather than inside it.
    const playerIds = (playersRes.data ?? []).map(p => p.id)
    const sessionsRes = playerIds.length > 0
      ? await db.from('active_sessions').select('user_id, last_seen_at').in('user_id', playerIds)
      : { data: [] as { user_id: string; last_seen_at: string }[] }

    const seenAt = new Map((sessionsRes.data ?? []).map(s => [s.user_id, new Date(s.last_seen_at).getTime()]))
    const now = Date.now()
    const a = agentRes.data

    return {
      agent: {
        id: a.id,
        full_name: a.full_name || a.username,
        username: a.username,
        coin_balance: Number(a.coin_balance ?? 0),
        is_active: a.is_active,
        auto_locked_at: a.auto_locked_at,
        joined_date: new Date(a.created_at).toLocaleDateString('en-US', {
          timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric',
        }),
      },
      players: (playersRes.data ?? []).map(p => ({
        id: p.id,
        full_name: p.full_name || p.username,
        username: p.username,
        coin_balance: Number(p.coin_balance ?? 0),
        is_active: p.is_active,
        is_online: (now - (seenAt.get(p.id) ?? 0)) < 60_000,
        auto_locked_at: p.auto_locked_at,
      })),
      error: null as string | null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { agent: null, players: [], error: `Could not load agent: ${message}` }
  }
}

/**
 * Issue #93: combines the agent-detail lookup, the profit report, and
 * (optionally) the selected player's history into ONE requireAuth() call --
 * replaces the superadmin agent-detail page's previous 2-3 separate actions
 * (getAgentDetailAction + getAgentProfitReportAction +
 * getPlayerDetailHistoryAction), which fired independently every 3-second
 * live-sync poll, each paying its own auth round-trip. agentIdentifier is
 * resolved once here and reused for both the detail lookup and the profit
 * report, instead of each resolving it separately.
 */
export async function getAgentDetailBundleAction(
  agentIdentifier: string,
  profitParams: Omit<ProfitReportParams, 'targetAgentId'>,
  selectedPlayerId?: string
): Promise<{
  agent: Awaited<ReturnType<typeof runAgentDetail>>['agent']
  players: Awaited<ReturnType<typeof runAgentDetail>>['players']
  error: string | null
  profit: ProfitReport
  history: { game_plays: PlayerGamePlay[]; coin_movements: PlayerCoinMovement[]; error: string | null }
}> {
  const emptyHistory = { game_plays: [] as PlayerGamePlay[], coin_movements: [] as PlayerCoinMovement[], error: null }
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) {
    return { agent: null, players: [], error: auth.error, profit: EMPTY_PROFIT_REPORT, history: emptyHistory }
  }

  const agentId = await resolveAgentId(agentIdentifier)
  if (!agentId) {
    return { agent: null, players: [], error: 'Agent not found.', profit: EMPTY_PROFIT_REPORT, history: emptyHistory }
  }

  const [detail, profit, history] = await Promise.all([
    runAgentDetail(agentId),
    runAgentProfitReport(auth.user, { ...profitParams, targetAgentId: agentId }),
    selectedPlayerId ? runPlayerDetailHistory(auth.user, selectedPlayerId) : Promise.resolve(emptyHistory),
  ])

  return { agent: detail.agent, players: detail.players, error: detail.error, profit, history }
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────
export async function createAgentAction(formData: FormData) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }

  const full_name = (formData.get('name') as string || '').trim()
  const username  = (formData.get('username') as string || '').trim()
  const password  = (formData.get('password') as string || '').trim()

  if (!full_name || !username || !password) {
    return { error: 'Please provide a name, username and password.' }
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { error: 'Username must be 3-20 characters, letters and numbers only.' }
  }
  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters.' }
  }

  try {
    const { data, error } = await createAdminClient().auth.admin.createUser({
      email: `${username.toLowerCase()}@bestsmartgame.com`,
      password,
      email_confirm: true,
      user_metadata: { username, full_name, role: 'agent' },
    })

    if (error) {
      const m = error.message.toLowerCase()
      if (m.includes('already') || m.includes('exists') || m.includes('duplicate')) {
        return { error: `Username "${username}" is already taken.` }
      }
      return { error: error.message }
    }

    await logAuditEventAction('account', `Created agent @${username} (${full_name})`)
    revalidatePath('/superadmin/agents')
    return { success: true, agent_id: data.user?.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Could not create agent: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ISSUE COINS  (superadmin -> agent)
// ─────────────────────────────────────────────────────────────────────────────
export async function issueAgentCoinsAction(
  agentIdentifier: string,
  amount: number,
  direction: TransferDirection,
  reason?: string
) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }

  const whole = toWholeCoins(amount)
  if (whole === null) return { error: 'Please enter a whole number of coins greater than zero.' }
  if (direction !== 'credit' && direction !== 'debit') return { error: 'Invalid direction.' }
  const trimmedReason = reason?.trim() || null
  if (trimmedReason !== null && trimmedReason.length > 500) {
    return { error: 'Reason must be 500 characters or fewer.' }
  }

  try {
    const agentId = await resolveAgentId(agentIdentifier)
    if (!agentId) return { error: 'Agent not found.' }

    // Caller's own session: admin_issue_coins reads auth.uid() and refuses
    // anyone who is not a superadmin in public.profiles.
    const supabase = await createUserClient()
    const { data, error } = await supabase.rpc('admin_issue_coins', {
      p_agent_id: agentId,
      p_amount: whole,
      p_direction: direction,
      p_reason: trimmedReason,
    })

    if (error) {
      if (error.message.includes('INSUFFICIENT_COINS')) {
        return { error: 'That agent does not hold enough coins for this withdrawal.' }
      }
      return { error: error.message }
    }

    const result = asRpc<AdminIssueResult>(data)

    revalidatePath('/superadmin/agents')
    revalidatePath('/superadmin/agents/issued')
    return { success: true, agent_coin_balance: Number(result?.agent_coin_balance ?? 0) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Transfer failed: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK / UNBLOCK  (cascades to the agent's players)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Takes the DESIRED state, like setPlayerActiveAction. See the B-1 note there:
 * deriving the new value from a passed-in "current" value is what made both
 * buttons no-ops in v1.
 */
export async function setAgentActiveAction(agentIdentifier: string, isActive: boolean) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }

  try {
    const agentId = await resolveAgentId(agentIdentifier)
    if (!agentId) return { error: 'Agent not found.' }

    // The agent's own flip, the player cascade, active_sessions cleanup, and
    // the audit log entry all happen atomically inside set_agent_active --
    // Postgres's own transaction guarantees make a partial cascade (agent
    // blocked but only some players) structurally impossible, unlike the
    // previous sequence of independent .from(...) calls. Called with the
    // caller's own session (not createAdminClient()) so the RPC can identify
    // and authorize the caller itself, same pattern as agent_transfer_coins.
    const supabase = await createUserClient()
    const { data, error } = await supabase.rpc('set_agent_active', {
      p_agent_id: agentId,
      p_active: isActive,
    })

    if (error) {
      if (error.message.includes('AGENT_AUTO_LOCKED_RESET_PASSWORD_REQUIRED')) {
        return {
          error: 'This agent is temporarily locked from 5 failed login attempts. Reset their password to unlock -- activating directly is disabled for this case.',
        }
      }
      if (error.message.includes('Agent not found')) return { error: 'Agent not found.' }
      return { error: error.message }
    }

    const result = asRpc<SetAgentActiveResult>(data)
    const playerIds = result.cascaded_player_ids

    // Revoke (or restore) the actual Supabase Auth session for the agent and
    // every cascaded player. profiles.is_active alone does not invalidate an
    // already-issued JWT.
    //
    // Correction (2026-08-17 re-verification): this comment previously
    // claimed ban_duration is "enforced by Supabase Auth on every request,
    // independent of token TTL" and closes the window "immediately" -- that
    // was empirically disproven by this session's Issue #57 investigation
    // (tested live against a disposable account: an already-issued,
    // unexpired JWT keeps working normally after ban_duration is set; it
    // only blocks the *next token refresh*, surfacing later as a forced
    // local sign-out on the client). So this call does NOT immediately stop
    // a blocked account's still-valid JWT from being used.
    //
    // That's fine, because it was never the real backstop for coin movement:
    // agent_transfer_coins/admin_issue_coins re-check profiles.is_active
    // fresh from the database on every call (Issue #1), and that flag is
    // already false by the time this code runs -- so direct calls to those
    // RPCs are rejected regardless of JWT validity. This ban_duration call's
    // actual purpose is narrower: it stops the session from being *renewed*
    // going forward, which is what eventually forces a real, visible
    // sign-out on whatever client (dashboard or app) is still using it. This
    // step is necessarily separate from the RPC above -- it calls Supabase's
    // Auth admin API, a different system from Postgres, so it cannot join
    // that transaction. A failure here does not roll back the RPC's
    // already-committed state.
    const db = createAdminClient()
    const banTargets = [agentId, ...playerIds]
    const banFailures: string[] = []
    for (const userId of banTargets) {
      const { error: banError } = await db.auth.admin.updateUserById(userId, {
        ban_duration: isActive ? 'none' : '876000h',
      })
      if (banError) banFailures.push(userId)
    }
    if (banFailures.length > 0) {
      console.error(
        `setAgentActiveAction: failed to ${isActive ? 'unban' : 'ban'} Auth session(s) for: ${banFailures.join(', ')}`
      )
    }

    revalidatePath('/superadmin/agents')
    return { success: true, is_active: isActive, cascaded: playerIds.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Could not update agent: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD RESET
// ─────────────────────────────────────────────────────────────────────────────
export async function updateAgentPasswordAction(agentIdentifier: string, newPassword: string) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }

  if (!newPassword || newPassword.trim().length < 6) {
    return { error: 'Password must be at least 6 characters.' }
  }

  try {
    const agentId = await resolveAgentId(agentIdentifier)
    if (!agentId) return { error: 'Agent not found.' }

    const db = createAdminClient()
    const { data: agent } = await db.from('profiles').select('username').eq('id', agentId).single()

    const { error } = await db.auth.admin.updateUserById(agentId, { password: newPassword.trim() })
    if (error) return { error: error.message }

    // Unlock ONLY if this agent was auto-locked by the failed-login counter
    // (auto_locked_at IS NOT NULL) -- never unconditionally set is_active:true
    // here, for the same reason as the player version: an agent deliberately
    // blocked for an unrelated reason (auto_locked_at stays NULL) must not be
    // silently reactivated just because someone reset their password.
    await db
      .from('profiles')
      .update({ is_active: true, failed_login_attempts: 0, auto_locked_at: null })
      .eq('id', agentId)
      .not('auto_locked_at', 'is', null)

    await logAuditEventAction('security', `Reset password for agent @${agent?.username ?? agentId}`)
    revalidatePath('/superadmin/agents')
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Could not reset password: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COINS ISSUED LEDGER
// ─────────────────────────────────────────────────────────────────────────────
export async function getAgentCoinLedgerAction(params?: {
  agentId?: string
  startDate?: string
  endDate?: string
  direction?: 'credit' | 'debit' | 'all'
  /**
   * B-6 FIX: search is applied server-side. The page previously filtered the
   * ten rows it had already been given, so a match on any other page was
   * invisible and the result count was misleading.
   */
  search?: string
  page?: number
  limit?: number
}) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) {
    return { rows: [], total_items: 0, total_pages: 1,
             summary: { credited: 0, debited: 0, net: 0 }, error: auth.error }
  }

  try {
    const db = createAdminClient()
    const page = Math.max(1, params?.page ?? 1)
    const limit = Math.min(100, Math.max(1, params?.limit ?? 10))

    // Agent names are resolved with a second query rather than a PostgREST
    // embed — embeds silently drop rows when a relationship cannot be resolved
    // and they defeat the generated column types.
    let base = db.from('coin_ledger')
      .select('id, user_id, amount, balance_after, kind, note, created_at', { count: 'exact' })
      .in('kind', ['admin_credit', 'admin_debit'])

    if (params?.agentId && params.agentId !== 'all') {
      const id = await resolveAgentId(params.agentId)
      if (id) base = base.eq('user_id', id)
    }

    // Resolve a free-text search to the set of agent ids it matches, then
    // filter the ledger by those ids — so the search spans every page.
    let searchIds: string[] | null = null
    if (params?.search?.trim()) {
      const term = `%${params.search.trim()}%`
      const { data: matches } = await db
        .from('profiles').select('id').eq('role', 'agent')
        .or(`username.ilike.${term},full_name.ilike.${term}`)
      searchIds = (matches ?? []).map(m => m.id)
      // No agent matched: return an empty page rather than an unfiltered one.
      if (searchIds.length === 0) {
        return { rows: [], total_items: 0, total_pages: 1,
                 summary: { credited: 0, debited: 0, net: 0 }, error: null }
      }
      base = base.in('user_id', searchIds)
    }

    if (params?.direction === 'credit') base = base.gt('amount', 0)
    if (params?.direction === 'debit')  base = base.lt('amount', 0)
    // Issue #19 FIX: endDate now arrives from the caller as an already-exact
    // IST end-of-day instant -- passed through unchanged, same as startDate,
    // instead of being re-widened here with a server-local-time setHours()
    // call (which silently corrupted the boundary by however many hours off
    // UTC the deployment server's own clock happened to be, even when the
    // caller had already sent a correct value).
    if (params?.startDate) base = base.gte('created_at', new Date(params.startDate).toISOString())
    if (params?.endDate) base = base.lte('created_at', new Date(params.endDate).toISOString())

    const { data, count, error } = await base
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)
    if (error) throw new Error(error.message)

    // Summary over the same filter, not just the current page (fixes B-7's
    // sibling: totals that ignored the active filter).
    let summaryQuery = db.from('coin_ledger').select('amount')
      .in('kind', ['admin_credit', 'admin_debit']).range(0, 999999)
    if (params?.agentId && params.agentId !== 'all') {
      const id = await resolveAgentId(params.agentId)
      if (id) summaryQuery = summaryQuery.eq('user_id', id)
    }
    // The summary honours the same search as the table.
    if (searchIds) summaryQuery = summaryQuery.in('user_id', searchIds)
    if (params?.direction === 'credit') summaryQuery = summaryQuery.gt('amount', 0)
    if (params?.direction === 'debit') summaryQuery = summaryQuery.lt('amount', 0)
    if (params?.startDate) summaryQuery = summaryQuery.gte('created_at', new Date(params.startDate).toISOString())
    if (params?.endDate) summaryQuery = summaryQuery.lte('created_at', new Date(params.endDate).toISOString())
    const { data: summaryData, error: summaryError } = await summaryQuery
    if (summaryError) throw new Error(summaryError.message)

    let credited = 0, debited = 0
    for (const r of summaryData ?? []) {
      const amt = Number(r.amount ?? 0)
      if (amt > 0) credited += amt; else debited += Math.abs(amt)
    }

    const agentIds = [...new Set((data ?? []).map(r => r.user_id))]
    const agentById = new Map<string, { username: string; full_name: string | null }>()
    if (agentIds.length > 0) {
      const { data: agents } = await db
        .from('profiles').select('id, username, full_name').in('id', agentIds)
      for (const a of agents ?? []) {
        agentById.set(a.id, { username: a.username, full_name: a.full_name })
      }
    }

    return {
      rows: (data ?? []).map(row => {
        const p = agentById.get(row.user_id)
        return {
          id: row.id,
          agent_id: row.user_id,
          agent_name: p?.full_name || p?.username || 'Agent',
          agent_username: `@${p?.username ?? 'agent'}`,
          direction: (isCredit(Number(row.amount)) ? 'credit' : 'debit') as 'credit' | 'debit',
          amount: Math.abs(Number(row.amount)),
          balance_after: Number(row.balance_after),
          note: row.note as string | null,
          created_at: istDateTime(row.created_at),
          created_at_iso: row.created_at,
        }
      }),
      total_items: count ?? 0,
      total_pages: Math.max(1, Math.ceil((count ?? 0) / limit)),
      summary: { credited, debited, net: credited - debited },
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { rows: [], total_items: 0, total_pages: 1,
             summary: { credited: 0, debited: 0, net: 0 },
             error: `Could not load ledger: ${message}` }
  }
}

/**
 * Per-agent breakdown for the same date range as getAgentCoinLedgerAction --
 * a single overall net figure hides which agent it actually came from. Same
 * filters (date range, search) minus the single-agent filter, since the
 * whole point here is to compare across agents.
 */
export async function getAgentCoinLedgerBreakdownAction(params?: {
  startDate?: string
  endDate?: string
  search?: string
}) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { rows: [], error: auth.error }

  try {
    const db = createAdminClient()
    let query = db.from('coin_ledger').select('user_id, amount')
      .in('kind', ['admin_credit', 'admin_debit']).range(0, 999999)

    if (params?.search?.trim()) {
      const term = `%${params.search.trim()}%`
      const { data: matches } = await db
        .from('profiles').select('id').eq('role', 'agent')
        .or(`username.ilike.${term},full_name.ilike.${term}`)
      const searchIds = (matches ?? []).map(m => m.id)
      if (searchIds.length === 0) return { rows: [], error: null }
      query = query.in('user_id', searchIds)
    }
    if (params?.startDate) query = query.gte('created_at', new Date(params.startDate).toISOString())
    if (params?.endDate) query = query.lte('created_at', new Date(params.endDate).toISOString())

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const byAgent = new Map<string, { credited: number; debited: number }>()
    for (const r of data ?? []) {
      const amt = Number(r.amount ?? 0)
      const entry = byAgent.get(r.user_id) ?? { credited: 0, debited: 0 }
      if (amt > 0) entry.credited += amt; else entry.debited += Math.abs(amt)
      byAgent.set(r.user_id, entry)
    }

    const agentIds = [...byAgent.keys()]
    const agentById = new Map<string, { username: string; full_name: string | null }>()
    if (agentIds.length > 0) {
      const { data: agents } = await db.from('profiles').select('id, username, full_name').in('id', agentIds)
      for (const a of agents ?? []) agentById.set(a.id, { username: a.username, full_name: a.full_name })
    }

    const rows = agentIds.map(id => {
      const p = agentById.get(id)
      const { credited, debited } = byAgent.get(id)!
      return {
        agent_id: id,
        agent_name: p?.full_name || p?.username || 'Agent',
        agent_username: `@${p?.username ?? 'agent'}`,
        credited, debited, net: credited - debited,
      }
    }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

    return { rows, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { rows: [], error: `Could not load breakdown: ${message}` }
  }
}

/**
 * Full, unpaginated export for CSV download -- same filters as
 * getAgentCoinLedgerAction, capped at 50,000 rows (a sane ceiling; a real
 * export beyond that belongs in a background job, not a browser download).
 */
export async function exportAgentCoinLedgerAction(params?: {
  agentId?: string
  startDate?: string
  endDate?: string
  direction?: 'credit' | 'debit' | 'all'
  search?: string
}) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { rows: [], error: auth.error }

  try {
    const db = createAdminClient()
    let base = db.from('coin_ledger')
      .select('user_id, amount, balance_after, note, created_at')
      .in('kind', ['admin_credit', 'admin_debit'])

    if (params?.agentId && params.agentId !== 'all') {
      const id = await resolveAgentId(params.agentId)
      if (id) base = base.eq('user_id', id)
    }
    if (params?.search?.trim()) {
      const term = `%${params.search.trim()}%`
      const { data: matches } = await db
        .from('profiles').select('id').eq('role', 'agent')
        .or(`username.ilike.${term},full_name.ilike.${term}`)
      const searchIds = (matches ?? []).map(m => m.id)
      if (searchIds.length === 0) return { rows: [], error: null }
      base = base.in('user_id', searchIds)
    }
    if (params?.direction === 'credit') base = base.gt('amount', 0)
    if (params?.direction === 'debit')  base = base.lt('amount', 0)
    if (params?.startDate) base = base.gte('created_at', new Date(params.startDate).toISOString())
    if (params?.endDate) base = base.lte('created_at', new Date(params.endDate).toISOString())

    const { data, error } = await base.order('created_at', { ascending: false }).range(0, 49999)
    if (error) throw new Error(error.message)

    const agentIds = [...new Set((data ?? []).map(r => r.user_id))]
    const agentById = new Map<string, { username: string; full_name: string | null }>()
    if (agentIds.length > 0) {
      const { data: agents } = await db.from('profiles').select('id, username, full_name').in('id', agentIds)
      for (const a of agents ?? []) agentById.set(a.id, { username: a.username, full_name: a.full_name })
    }

    return {
      rows: (data ?? []).map(row => {
        const p = agentById.get(row.user_id)
        return {
          agent_username: p?.username ?? 'agent',
          direction: (isCredit(Number(row.amount)) ? 'credit' : 'debit') as 'credit' | 'debit',
          amount: Math.abs(Number(row.amount)),
          balance_after: Number(row.balance_after),
          note: (row.note as string | null) ?? '',
          created_at: istDateTime(row.created_at),
        }
      }),
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { rows: [], error: `Could not export ledger: ${message}` }
  }
}
