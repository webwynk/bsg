'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createUserClient, createAdminClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { asRpc, type AgentTransferResult } from '@/lib/rpc'
import { GAMEPLAY_KINDS, isCredit, ledgerKindLabel, toWholeCoins, type LedgerKind, type TransferDirection } from '@/lib/ledger'
import { USERNAME_PATTERN } from '@/lib/validation'
import { resolveAgentId } from '@/app/superadmin/agents/actions'

/**
 * Player management for the agent back office.
 *
 * ARCHITECTURAL RULE INTRODUCED HERE
 *   Money RPCs are invoked with the CALLER'S session (createUserClient), never
 *   with the service-role client. The v2 functions derive identity from
 *   auth.uid(); calling them with the service key would leave the database
 *   unable to tell who acted, which is exactly how v1 ended up allowing
 *   unauthenticated coin minting. The service-role client is used only for
 *   reads and for Auth admin operations that have already been authorised here.
 */


function istDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Resolves a username or UUID to a profile id, scoped to what the caller may see. */
async function resolvePlayerId(identifier: string): Promise<string | null> {
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
async function assertOwnership(
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

// ─────────────────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────────────────
export interface PlayerRow {
  id: string
  full_name: string
  username: string
  coin_balance: number
  is_active: boolean
  is_online: boolean
  /** Set only when is_active:false was caused by the 5-failed-login
   * auto-lock (Issue #52) -- null for a deliberate agent/superadmin block.
   * Lets the UI show "Temporary Block" instead of "Blocked", and route
   * unlocking through a password reset instead of a direct Activate button. */
  auto_locked_at: string | null
}

export async function getPlayersAction(
  targetAgentId?: string
): Promise<{ players: PlayerRow[]; error: string | null }> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { players: [], error: auth.error }

  // Cross-tenant guard: only a superadmin may look at someone else's roster.
  // targetAgentId may arrive as a username or an already-resolved UUID --
  // resolveAgentId (Issue #64, mirrors Issue #8's fix) handles both, so this
  // action stays correct for any future caller, not just today's zero-arg one.
  let agentId = auth.user.id
  if (auth.user.role === 'superadmin' && targetAgentId) {
    const resolved = await resolveAgentId(targetAgentId)
    if (!resolved) return { players: [], error: 'Agent not found.' }
    agentId = resolved
  }

  try {
    const db = createAdminClient()
    const [profilesRes, sessionsRes] = await Promise.all([
      db.from('profiles')
        .select('id, username, full_name, coin_balance, is_active, auto_locked_at')
        .eq('agent_id', agentId)
        .order('username'),
      db.from('active_sessions').select('user_id, last_seen_at'),
    ])
    if (profilesRes.error) throw new Error(profilesRes.error.message)

    const seenAt = new Map((sessionsRes.data ?? []).map(s => [s.user_id, new Date(s.last_seen_at).getTime()]))
    const now = Date.now()

    return {
      players: (profilesRes.data ?? []).map(p => ({
        id: p.id,
        full_name: p.full_name || p.username,
        username: p.username,
        coin_balance: Number(p.coin_balance ?? 0),
        is_active: p.is_active,
        is_online: (now - (seenAt.get(p.id) ?? 0)) < 60_000,
        auto_locked_at: p.auto_locked_at,
      })),
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { players: [], error: `Could not load players: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────
export async function createPlayerAction(formData: FormData) {
  const auth = await requireAuth(['agent'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }

  const full_name = (formData.get('name') as string || '').trim()
  const username  = (formData.get('username') as string || '').trim()
  const password  = (formData.get('password') as string || '').trim()

  if (!full_name || !username || !password) {
    return { error: 'Please provide a name, username and password.' }
  }
  // Matches the database CHECK on profiles.username.
  if (!USERNAME_PATTERN.test(username)) {
    return { error: 'Username must be 3-20 characters, letters and numbers only.' }
  }
  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters.' }
  }

  try {
    const { data, error } = await createAdminClient().auth.admin.createUser({
      email: `${username.toLowerCase()}@bestsmartgame.com`,   // matches the DB CHECK
      password,
      email_confirm: true,
      user_metadata: {
        username,
        full_name,
        role: 'player',
        agent_id: auth.user.id,      // the trigger requires this for players
      },
    })

    if (error) {
      const m = error.message.toLowerCase()
      if (m.includes('already') || m.includes('exists') || m.includes('duplicate')) {
        return { error: `Username "${username}" is already taken.` }
      }
      return { error: error.message }
    }

    revalidatePath('/agent/players')
    revalidatePath('/agent')
    return { success: true, player_id: data.user?.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Could not create player: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK / UNBLOCK
// ─────────────────────────────────────────────────────────────────────────────
/**
 * B-1 FIX — the signature now takes the DESIRED state, not the current one.
 *
 * The old action took `currentStatus` and derived the new value itself, while
 * the page passed the *next* status it had already computed. The two
 * cancelled out, so blocking set the player to Active and unblocking set them
 * to Blocked — both buttons were no-ops in production.
 *
 * Passing the intended end state removes the whole class of error: there is no
 * longer any inversion for the caller to get wrong.
 */
export async function setPlayerActiveAction(playerIdentifier: string, isActive: boolean) {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }

  try {
    const playerId = await resolvePlayerId(playerIdentifier)
    if (!playerId) return { error: 'Player account not found.' }

    const owned = await assertOwnership(auth.user, playerId)
    if (!owned.ok) return { error: owned.error }

    // Reactivating an auto-locked player must go through Password Reset, not
    // this direct toggle -- enforced here, not just hidden in the UI, so a
    // future UI change can never accidentally reopen the bypass. This is the
    // one case setPlayerActiveAction refuses; deactivating (isActive:false)
    // is always allowed, and reactivating a MANUALLY blocked player
    // (auto_locked_at is null) is unaffected -- exactly the toggle's normal job.
    if (isActive && owned.player.auto_locked_at) {
      return {
        error: 'This player is temporarily blocked from 5 failed login attempts. Reset their password to unlock -- activating directly is disabled for this case.',
      }
    }

    // profiles.is_active is the single source of truth: the heartbeat reads it,
    // and every dashboard view renders from it. v1 wrote only auth metadata,
    // so a blocked account kept playing and still displayed as Active.
    //
    // Reactivating also clears failed_login_attempts/auto_locked_at, so a
    // player manually unblocked for an unrelated reason doesn't resume
    // halfway toward the automatic 5-strike lockout from before they were
    // blocked. Deactivating leaves those columns untouched -- a fresh set of
    // 5 attempts still applies the next time they're reactivated and try to
    // log in, unrelated to whatever reason this block happened for.
    const { error } = await createAdminClient()
      .from('profiles')
      .update(
        isActive
          ? { is_active: true, failed_login_attempts: 0, auto_locked_at: null, updated_at: new Date().toISOString() }
          : { is_active: false, updated_at: new Date().toISOString() }
      )
      .eq('id', playerId)

    if (error) return { error: error.message }

    // Blocking should also end the live session, otherwise the player keeps
    // playing until their next heartbeat.
    if (!isActive) {
      await createAdminClient().from('active_sessions').delete().eq('user_id', playerId)
    }

    // Revoke (or restore) the player's actual Supabase Auth session.
    // profiles.is_active alone does not invalidate an already-issued JWT.
    //
    // Correction (2026-08-17 re-verification): this comment previously
    // claimed ban_duration is "enforced by Supabase Auth on every request,
    // independent of token TTL" -- disproven live during this session's
    // Issue #57 investigation: an already-issued, unexpired JWT keeps
    // working normally after ban_duration is set; it only blocks the next
    // token *refresh*, which the app's own AuthProvider now listens for
    // directly (onForcedSignOut) rather than assuming this call ends things
    // immediately. The real backstop for a still-valid JWT is elsewhere:
    // session_heartbeat and place_bet each re-check profiles.is_active fresh
    // on every call, and that flag is already false by the time this code
    // runs -- so betting and the heartbeat's graceful reply both correctly
    // reject the account regardless of whether this ban call has taken
    // effect yet.
    const { error: banError } = await createAdminClient().auth.admin.updateUserById(playerId, {
      ban_duration: isActive ? 'none' : '876000h',
    })
    if (banError) {
      console.error(`setPlayerActiveAction: failed to ${isActive ? 'unban' : 'ban'} Auth session for ${playerId}: ${banError.message}`)
    }

    revalidatePath('/agent/players')
    return { success: true, is_active: isActive }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Could not update player: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFER COINS
// ─────────────────────────────────────────────────────────────────────────────
export async function transferPlayerCoinsAction(
  playerIdentifier: string,
  amount: number,
  direction: TransferDirection
) {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }

  const whole = toWholeCoins(amount)
  if (whole === null) return { error: 'Please enter a whole number of coins greater than zero.' }
  if (direction !== 'credit' && direction !== 'debit') return { error: 'Invalid transfer direction.' }

  try {
    const playerId = await resolvePlayerId(playerIdentifier)
    if (!playerId) return { error: 'Player account not found.' }

    // Called with the caller's own session so the database can identify them.
    // The RPC re-checks ownership itself; this is defence in depth, not a
    // substitute for it.
    const supabase = await createUserClient()
    const { data, error } = await supabase.rpc('agent_transfer_coins', {
      p_player_id: playerId,
      p_amount: whole,
      p_direction: direction,
    })

    if (error) {
      if (error.message.includes('INSUFFICIENT_COINS')) {
        return { error: 'Not enough coins available for this transfer.' }
      }
      if (error.message.includes('UNAUTHORIZED_NOT_YOUR_PLAYER')) {
        return { error: 'That player belongs to another agent.' }
      }
      return { error: error.message }
    }

    const result = asRpc<AgentTransferResult>(data)

    revalidatePath('/agent/players')
    revalidatePath('/agent')
    revalidatePath('/agent/history')
    return {
      success: true,
      player_coin_balance: Number(result?.player_coin_balance ?? 0),
      agent_coin_balance: Number(result?.agent_coin_balance ?? 0),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Transfer failed: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD RESET
// ─────────────────────────────────────────────────────────────────────────────
export async function resetPlayerPasswordAction(playerIdentifier: string, newPassword: string) {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }

  if (!newPassword || newPassword.trim().length < 6) {
    return { error: 'Password must be at least 6 characters.' }
  }

  try {
    const playerId = await resolvePlayerId(playerIdentifier)
    if (!playerId) return { error: 'Player account not found.' }

    const owned = await assertOwnership(auth.user, playerId)
    if (!owned.ok) return { error: owned.error }

    const { error } = await createAdminClient().auth.admin.updateUserById(playerId, {
      password: newPassword.trim(),
    })
    if (error) return { error: error.message }

    // Unlock ONLY if this player was auto-locked by the failed-login counter
    // (auto_locked_at IS NOT NULL) -- never unconditionally set is_active:true
    // here. A player deliberately blocked by an agent for an unrelated
    // reason (auto_locked_at stays NULL) must not be silently reactivated
    // just because someone reset their password; that decision stays with
    // whoever blocked them, via the separate Activate/Block toggle above.
    const { error: unlockError } = await createAdminClient()
      .from('profiles')
      .update({ is_active: true, failed_login_attempts: 0, auto_locked_at: null })
      .eq('id', playerId)
      .not('auto_locked_at', 'is', null)
    if (unlockError) {
      console.error(`resetPlayerPasswordAction: failed to clear auto-lock for ${playerId}: ${unlockError.message}`)
    }

    revalidatePath('/agent/players')
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Could not reset password: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────
export interface AgentNotification {
  id: string
  message: string
  is_read: boolean
  created_at: string
  created_at_display: string
  /** Null for a notification created before player_id existed, or whose
   * player has since been deleted (ON DELETE SET NULL) -- the UI hides the
   * reset-password action for those rather than acting on a name parsed
   * back out of the message text. */
  player_id: string | null
  player_username: string | null
  player_full_name: string | null
  /** True while the player this alert is about is STILL auto-locked right
   * now (profiles.auto_locked_at still set) -- read live from profiles, not
   * a flag stored on the notification, so a reset from EITHER the Players
   * page or this alert's own Reset Password button both correctly flip this
   * to false. False also (not just "resolved") when there's no linked
   * player at all. */
  player_still_locked: boolean
  /** Issue #67: same idea as player_id/player_still_locked, but for a
   * staff (agent/superadmin) lockout alert -- lets the superadmin alerts
   * page offer a direct Reset Password action too, instead of only
   * informing. Null for a notification predating locked_staff_id, or a
   * non-lockout notification kind. */
  staff_id: string | null
  staff_username: string | null
  staff_full_name: string | null
  staff_still_locked: boolean
}

/** Unread-first, newest-first. Superadmin sees every agent's alerts; an
 * agent sees only their own -- matches getPlayersAction's existing scoping
 * pattern (service-role client + explicit agent_id filter, not RLS, since
 * this file's established convention is server-side scoping in TypeScript). */
export async function getAgentNotificationsAction(): Promise<{ notifications: AgentNotification[]; error: string | null }> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { notifications: [], error: auth.error }

  try {
    const db = createAdminClient()
    let query = db
      .from('notifications')
      .select('id, message, read_at, created_at, player_id, locked_staff_id')
      .order('created_at', { ascending: false })
      .limit(200)

    if (auth.user.role === 'agent') {
      // An agent sees only alerts about their own players.
      query = query.eq('agent_id', auth.user.id)
    } else {
      // User-requested scope: a superadmin sees only alerts ABOUT AN AGENT
      // (the staff-lockout broadcasts from Issue #60, agent_id IS NULL) --
      // never an individual player's lockout, even though that player
      // technically belongs to one of their agents. Player-level problems
      // stay with that player's own agent to handle; the superadmin only
      // needs to know when an agent account itself is in trouble.
      query = query.is('agent_id', null)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    // One batched lookup covering every referenced player AND staff account,
    // not one query per row -- both are just profiles rows, so a single
    // combined .in() covers both id sets. auto_locked_at is read live here --
    // it's the single source of truth profiles itself uses, so a reset from
    // the Players/Agents page or this alert's own button all correctly flip
    // this to false, with nothing to keep in sync separately.
    const playerIds = [...new Set((data ?? []).map(n => n.player_id).filter((id): id is string => id !== null))]
    const staffIds = [...new Set((data ?? []).map(n => n.locked_staff_id).filter((id): id is string => id !== null))]
    const profilesById = new Map<string, { username: string; full_name: string; auto_locked_at: string | null }>()
    const allIds = [...new Set([...playerIds, ...staffIds])]
    if (allIds.length > 0) {
      const { data: profiles } = await db.from('profiles').select('id, username, full_name, auto_locked_at').in('id', allIds)
      for (const p of profiles ?? []) profilesById.set(p.id, { username: p.username, full_name: p.full_name || p.username, auto_locked_at: p.auto_locked_at })
    }

    return {
      notifications: (data ?? []).map(n => {
        const player = n.player_id ? profilesById.get(n.player_id) : undefined
        const staff = n.locked_staff_id ? profilesById.get(n.locked_staff_id) : undefined
        return {
          id: n.id,
          message: n.message,
          is_read: n.read_at !== null,
          created_at: n.created_at,
          created_at_display: istDateTime(n.created_at),
          player_id: player ? n.player_id : null,
          player_username: player?.username ?? null,
          player_full_name: player?.full_name ?? null,
          player_still_locked: player?.auto_locked_at != null,
          staff_id: staff ? n.locked_staff_id : null,
          staff_username: staff?.username ?? null,
          staff_full_name: staff?.full_name ?? null,
          staff_still_locked: staff?.auto_locked_at != null,
        }
      }),
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { notifications: [], error: `Could not load notifications: ${message}` }
  }
}

/** Scoped to the caller's own notifications -- an agent cannot mark another
 * agent's alert read, even by guessing an id (superadmin may, matching their
 * read access above). */
export async function markNotificationReadAction(notificationId: string) {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { error: auth.error ?? 'Unauthorized' }

  try {
    let query = createAdminClient()
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)

    if (auth.user.role === 'agent') {
      query = query.eq('agent_id', auth.user.id)
    }

    const { error } = await query
    if (error) return { error: error.message }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Could not update notification: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER DETAIL — game plays + coin movements
// ─────────────────────────────────────────────────────────────────────────────
export interface PlayerGamePlay {
  hand_id: string
  round_number: number
  mode: string
  selections: string
  result: string
  total_stake: number
  total_payout: number
  outcome: 'WON' | 'LOST'
  is_settled: boolean
  created_at: string
  created_at_iso: string
  /** Raw per-cell stakes, for the expandable board breakdown in the UI. */
  single_bets: Record<string, number>
  double_bets: Record<string, number>
  triple_bets: Record<string, number>
  red: number | null
  green: number | null
  black: number | null
}

export interface PlayerCoinMovement {
  id: string
  kind: LedgerKind
  label: string
  /** 'gameplay' for stake/stake_refund/payout, 'cashier' for agent_credit/agent_debit. */
  category: 'gameplay' | 'cashier'
  direction: 'deposit' | 'withdraw'
  amount: number
  balance_after: number
  created_at: string
  created_at_iso: string
}

export async function getPlayerDetailHistoryAction(playerIdentifier: string): Promise<{
  game_plays: PlayerGamePlay[]
  coin_movements: PlayerCoinMovement[]
  error: string | null
}> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { game_plays: [], coin_movements: [], error: auth.error }

  try {
    const playerId = await resolvePlayerId(playerIdentifier)
    if (!playerId) return { game_plays: [], coin_movements: [], error: 'Player not found.' }

    const owned = await assertOwnership(auth.user, playerId)
    if (!owned.ok) return { game_plays: [], coin_movements: [], error: owned.error }

    const db = createAdminClient()

    // A real foreign key now exists, so a single embedded select is safe.
    // v1 needed a two-step fetch-and-merge because the join silently dropped
    // rows; the payout no longer has to be recomputed client-side either —
    // settle_round() writes the authoritative figures.
    const [betsRes, ledgerRes] = await Promise.all([
      db.from('bets')
        .select(`id, round_id, single_bets, double_bets, triple_bets,
                 total_stake, total_payout, is_settled, created_at,
                 rounds!inner ( round_number, red, green, black )`)
        .eq('user_id', playerId)
        .order('created_at', { ascending: false })
        .limit(100),
      db.from('coin_ledger')
        .select('id, kind, amount, balance_after, created_at')
        .eq('user_id', playerId)
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    if (betsRes.error) throw new Error(`bets: ${betsRes.error.message}`)
    if (ledgerRes.error) throw new Error(`ledger: ${ledgerRes.error.message}`)

    const game_plays: PlayerGamePlay[] = (betsRes.data ?? []).map(b => {
      const round = (b as unknown as { rounds: { round_number: number; red: number | null; green: number | null; black: number | null } }).rounds
      const single = (b.single_bets ?? {}) as Record<string, number>
      const dbl    = (b.double_bets ?? {}) as Record<string, number>
      const triple = (b.triple_bets ?? {}) as Record<string, number>

      const modes: string[] = []
      if (Object.keys(single).length) modes.push('SINGLE')
      if (Object.keys(dbl).length)    modes.push('DOUBLE')
      if (Object.keys(triple).length) modes.push('TRIPLE')

      const parts: string[] = []
      if (Object.keys(single).length) parts.push(`Single: ${Object.keys(single).join(',')}`)
      if (Object.keys(dbl).length)    parts.push(`Double: ${Object.keys(dbl).join(',')}`)
      if (Object.keys(triple).length) parts.push(`Triple: ${Object.keys(triple).join(',')}`)

      const drawn = round.red !== null && round.green !== null && round.black !== null
      const payout = Number(b.total_payout ?? 0)

      return {
        // Canonical Hand ID: last 8 characters of the round UUID, identical to
        // what the game app shows the player.
        hand_id: `...${String(b.round_id).slice(-8)}`,
        round_number: Number(round.round_number),
        mode: modes.join(' + ') || 'TRIPLE CHANCE',
        selections: parts.join(' | ') || 'Multi-board bet',
        result: drawn ? `${round.red} . ${round.green} . ${round.black}` : '—',
        total_stake: Number(b.total_stake ?? 0),
        total_payout: payout,
        outcome: payout > 0 ? 'WON' : 'LOST',
        is_settled: Boolean(b.is_settled),
        created_at: istDateTime(b.created_at),
        created_at_iso: b.created_at,
        single_bets: single,
        double_bets: dbl,
        triple_bets: triple,
        red: round.red,
        green: round.green,
        black: round.black,
      }
    })

    const coin_movements: PlayerCoinMovement[] = (ledgerRes.data ?? []).map(row => ({
      id: row.id,
      kind: row.kind as LedgerKind,
      label: ledgerKindLabel(row.kind),
      category: GAMEPLAY_KINDS.includes(row.kind as LedgerKind) ? 'gameplay' : 'cashier',
      direction: isCredit(Number(row.amount)) ? 'deposit' : 'withdraw',
      amount: Math.abs(Number(row.amount)),
      balance_after: Number(row.balance_after),
      created_at: istDateTime(row.created_at),
      created_at_iso: row.created_at,
    }))

    return { game_plays, coin_movements, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { game_plays: [], coin_movements: [], error: `Could not load history: ${message}` }
  }
}
