import type { createAdminClient } from './supabase'
import { fetchAccountCodes } from './account-codes'
import {
  DESKTOP_PLAYERS_PER_PAGE,
  cleanDesktopSearch,
  scopeToAgent,
  type DesktopPlayersParams,
  type DesktopPlayersResult,
} from './desktop-players'

/** The most ID matches a search follows; a search is for finding a few players. */
const MAX_ID_MATCHES = 200

/**
 * One page of the Desktop Player tab, and the All, ON and OFF counts. Search,
 * filter and paging all run in the database, so the page stays fast as players
 * grow. A player with no print_players row has never had Print, so is OFF.
 *
 * agentId limits every player read to that agent's players; null means all
 * players. Callers must have run requireAuth() first, and must take agentId from
 * the signed-in account, never from the browser: db is the service-role client,
 * which row rules do not limit.
 */
export async function runDesktopPlayers(
  db: ReturnType<typeof createAdminClient>,
  params: DesktopPlayersParams,
  agentId: string | null,
): Promise<DesktopPlayersResult> {
  try {
    const search = cleanDesktopSearch(params.search)
    const page = Math.max(1, Math.floor(params.page) || 1)

    const [allRes, onRes, codeRes] = await Promise.all([
      scopeToAgent(db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'player'), agentId),
      db.from('print_players').select('user_id').eq('enabled', true),
      search
        ? db.from('account_codes').select('user_id').ilike('code', `%${search}%`).limit(MAX_ID_MATCHES)
        : Promise.resolve({ data: [] as { user_id: string }[], error: null }),
    ])
    if (allRes.error) throw new Error(allRes.error.message)
    if (onRes.error) throw new Error(onRes.error.message)
    if (codeRes.error) throw new Error(codeRes.error.message)

    const onIds = (onRes.data ?? []).map(row => row.user_id)
    let onCount = onIds.length
    if (agentId && onIds.length > 0) {
      const ownOn = await scopeToAgent(
        db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'player').in('id', onIds),
        agentId,
      )
      if (ownOn.error) throw new Error(ownOn.error.message)
      onCount = ownOn.count ?? 0
    }
    const all = allRes.count ?? 0
    const counts = { all, on: onCount, off: Math.max(0, all - onCount) }
    if (params.filter === 'on' && onCount === 0) {
      return { rows: [], total: 0, counts, error: null }
    }

    let query = scopeToAgent(
      db.from('profiles')
        .select('id, username, full_name, coin_balance, is_active, auto_locked_at, agent_id', { count: 'exact' })
        .eq('role', 'player'),
      agentId,
    )
    if (params.filter === 'on') query = query.in('id', onIds)
    if (params.filter === 'off' && onIds.length > 0) query = query.not('id', 'in', `(${onIds.join(',')})`)
    if (search) {
      const codeIds = (codeRes.data ?? []).map(row => row.user_id)
      const conditions = [`username.ilike."%${search}%"`, `full_name.ilike."%${search}%"`]
      if (codeIds.length > 0) conditions.push(`id.in.(${codeIds.join(',')})`)
      query = query.or(conditions.join(','))
    }

    const from = (page - 1) * DESKTOP_PLAYERS_PER_PAGE
    const pageRes = await query.order('username').range(from, from + DESKTOP_PLAYERS_PER_PAGE - 1)
    if (pageRes.error) throw new Error(pageRes.error.message)

    const players = pageRes.data ?? []
    const ids = players.map(p => p.id)
    const agentIds = [...new Set(players.flatMap(p => (p.agent_id ? [p.agent_id] : [])))]
    const [codes, agentsRes, sessionsRes] = await Promise.all([
      fetchAccountCodes(db, ids),
      agentIds.length > 0
        ? db.from('profiles').select('id, username, full_name').in('id', agentIds)
        : Promise.resolve({ data: [] as { id: string; username: string; full_name: string | null }[] }),
      ids.length > 0
        ? db.from('active_sessions').select('user_id, last_seen_at').in('user_id', ids)
        : Promise.resolve({ data: [] as { user_id: string; last_seen_at: string }[] }),
    ])

    const agents = new Map((agentsRes.data ?? []).map(a => [a.id, a]))
    const seenAt = new Map((sessionsRes.data ?? []).map(s => [s.user_id, new Date(s.last_seen_at).getTime()]))
    const on = new Set(onIds)
    const now = Date.now()

    return {
      rows: players.map(p => {
        const agent = p.agent_id ? agents.get(p.agent_id) : undefined
        return {
          id: p.id,
          full_name: p.full_name || p.username,
          username: p.username,
          account_code: codes.get(p.id) ?? null,
          coin_balance: Number(p.coin_balance ?? 0),
          is_active: p.is_active,
          // The same 60-second window as the player list in agent/players/actions.ts.
          is_online: (now - (seenAt.get(p.id) ?? 0)) < 60_000,
          auto_locked_at: p.auto_locked_at,
          agent_name: agent ? agent.full_name || agent.username : null,
          agent_username: agent?.username ?? null,
          print_enabled: on.has(p.id),
        }
      }),
      total: pageRes.count ?? 0,
      counts,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { rows: [], total: 0, counts: { all: 0, on: 0, off: 0 }, error: `Could not load players: ${message}` }
  }
}
