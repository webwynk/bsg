'use server'

import { createAdminClient } from '@/lib/supabase'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth-guard'
import { asRpc, type CurrentRound } from '@/lib/rpc'

/**
 * SuperAdmin system actions — v2.
 *
 * Table renames from v1: transactions -> coin_ledger, triple_chance_bets ->
 * bets, triple_chance_rounds -> rounds, agent_configs -> game_config,
 * balance -> coin_balance, win_amount -> total_payout.
 *
 * Fixes carried in this rewrite:
 *   B-2  "Active Network" counted every profile regardless of is_active, so
 *        blocked accounts were reported as active.
 *   B-3  "Today Issued" only counted positive admin_adjustment rows, so
 *        withdrawals never reduced it and the label overstated issuance. It now
 *        nets admin_credit against admin_debit and is labelled as net issuance.
 *   M-7  The game_history fallback is gone; that table never existed.
 *
 * Errors are surfaced rather than swallowed — `catch (_) {}` around a query is
 * what allowed three schema mismatches to reach production unnoticed.
 */


function istDayStartISO(): string {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  return new Date(`${day}T00:00:00+05:30`).toISOString()
}

function istTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────
export type AuditKind = 'system' | 'coin' | 'security' | 'account'

export async function logAuditEventAction(kind: AuditKind, detail: string) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return

  try {
    await createAdminClient().from('audit_log').insert({ actor_id: auth.user.id, kind, detail })
  } catch {
    // Audit logging must never break the operation it is recording.
  }
}

export async function getAuditLogsAction(): Promise<{
  logs: Array<{ id: string; kind: string; detail: string; time: string; actor: string }>
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { logs: [], error: auth.error }

  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('audit_log')
      .select('id, kind, detail, created_at, actor_id')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)

    // Actor names come from a second query rather than a PostgREST embed.
    // Embeds silently drop rows when the relationship cannot be resolved — a
    // failure mode this codebase has already been bitten by — and they defeat
    // the generated column types.
    const actorIds = [...new Set((data ?? []).map(r => r.actor_id).filter((x): x is string => !!x))]
    const names = new Map<string, string>()
    if (actorIds.length > 0) {
      const { data: actors } = await db.from('profiles').select('id, username').in('id', actorIds)
      for (const a of actors ?? []) names.set(a.id, a.username)
    }

    return {
      logs: (data ?? []).map(row => ({
        id: row.id,
        kind: row.kind,
        detail: row.detail,
        time: istTime(row.created_at),
        actor: row.actor_id && names.has(row.actor_id) ? `@${names.get(row.actor_id)}` : 'system',
      })),
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { logs: [], error: `Could not load audit log: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
export interface SystemMetrics {
  total_coins: number
  net_issued_today: number
  active_agents: number
  active_players: number
  lifetime_bets: number
  lifetime_stake: number
  lifetime_payout: number
  lifetime_house: number
  today_bets: number
  today_stake: number
  today_payout: number
  today_house: number
  error: string | null
}

const EMPTY_METRICS: SystemMetrics = {
  total_coins: 0, net_issued_today: 0, active_agents: 0, active_players: 0,
  lifetime_bets: 0, lifetime_stake: 0, lifetime_payout: 0, lifetime_house: 0,
  today_bets: 0, today_stake: 0, today_payout: 0, today_house: 0, error: null,
}

export async function getSystemOverviewMetricsAction(): Promise<SystemMetrics> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { ...EMPTY_METRICS, error: auth.error }

  try {
    const db = createAdminClient()
    const dayStart = istDayStartISO()

    const [profilesRes, issuedRes, allBetsRes, todayBetsRes] = await Promise.all([
      // .range() defeats PostgREST's 1,000-row default cap.
      db.from('profiles').select('role, coin_balance, is_active').range(0, 999999),
      db.from('coin_ledger').select('amount')
        .in('kind', ['admin_credit', 'admin_debit'])
        .gte('created_at', dayStart).range(0, 999999),
      db.from('bets').select('total_stake, total_payout').range(0, 999999),
      db.from('bets').select('total_stake, total_payout')
        .gte('created_at', dayStart).range(0, 999999),
    ])
    if (profilesRes.error)  throw new Error(`profiles: ${profilesRes.error.message}`)
    if (issuedRes.error)    throw new Error(`ledger: ${issuedRes.error.message}`)
    if (allBetsRes.error)   throw new Error(`bets: ${allBetsRes.error.message}`)
    if (todayBetsRes.error) throw new Error(`today bets: ${todayBetsRes.error.message}`)

    let total_coins = 0, active_agents = 0, active_players = 0
    for (const p of profilesRes.data ?? []) {
      total_coins += Number(p.coin_balance ?? 0)
      // B-2: only count accounts that are actually active.
      if (!p.is_active) continue
      if (p.role === 'agent')  active_agents++
      if (p.role === 'player') active_players++
    }

    // B-3: net issuance — credits minus withdrawals, not credits alone.
    const net_issued_today = (issuedRes.data ?? [])
      .reduce((sum, r) => sum + Number(r.amount ?? 0), 0)

    const sum = (rows: Array<{ total_stake: unknown; total_payout: unknown }>) => ({
      count: rows.length,
      stake: rows.reduce((s, r) => s + Number(r.total_stake ?? 0), 0),
      payout: rows.reduce((s, r) => s + Number(r.total_payout ?? 0), 0),
    })
    const lifetime = sum(allBetsRes.data ?? [])
    const today = sum(todayBetsRes.data ?? [])

    return {
      total_coins,
      net_issued_today,
      active_agents,
      active_players,
      lifetime_bets: lifetime.count,
      lifetime_stake: lifetime.stake,
      lifetime_payout: lifetime.payout,
      lifetime_house: lifetime.stake - lifetime.payout,
      today_bets: today.count,
      today_stake: today.stake,
      today_payout: today.payout,
      today_house: today.stake - today.payout,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ...EMPTY_METRICS, error: `Could not load metrics: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RTP CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
export async function getRtpAction(): Promise<{ rtp: number; error: string | null }> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { rtp: 96, error: auth.error }

  try {
    const { data, error } = await createAdminClient()
      .from('game_config').select('rtp_percentage').eq('id', 'global').single()
    if (error) throw new Error(error.message)
    return { rtp: Number(data.rtp_percentage), error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { rtp: 96, error: `Could not read RTP: ${message}` }
  }
}

export async function updateRtpAction(rtpPercentage: number) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { success: false, error: auth.error ?? 'Unauthorized' }

  // The database enforces this range too (CHECK on game_config); validating
  // here just produces a friendlier message.
  if (typeof rtpPercentage !== 'number' || !Number.isFinite(rtpPercentage)
      || rtpPercentage < 50 || rtpPercentage > 100) {
    return { success: false, error: 'RTP must be a number between 50 and 100.' }
  }

  try {
    const { error } = await createAdminClient()
      .from('game_config')
      .update({ rtp_percentage: rtpPercentage, updated_at: new Date().toISOString() })
      .eq('id', 'global')
    if (error) throw new Error(error.message)

    await logAuditEventAction('system', `Global RTP target set to ${rtpPercentage}%`)
    revalidatePath('/superadmin')
    return { success: true, rtp: rtpPercentage, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: `Could not update RTP: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYOUT MULTIPLIER CONFIGURATION
//
// Issue #5: was hardcoded (x9/x90/x900) in draw_round, settle_round, AND the
// mobile app -- four independent copies, no single source of truth. Now
// lives in game_config alongside rtp_percentage; this is the one place it's
// ever set. draw_round/settle_round read it live; the app fetches it via
// get_play_limits().
// ─────────────────────────────────────────────────────────────────────────────
export type PayoutMultipliers = { single: number; double: number; triple: number }

export async function getPayoutMultipliersAction(): Promise<{ multipliers: PayoutMultipliers; error: string | null }> {
  const auth = await requireAuth(['superadmin'])
  const fallback: PayoutMultipliers = { single: 9, double: 90, triple: 900 }
  if (auth.error) return { multipliers: fallback, error: auth.error }

  try {
    const { data, error } = await createAdminClient()
      .from('game_config')
      .select('payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple')
      .eq('id', 'global')
      .single()
    if (error) throw new Error(error.message)
    return {
      multipliers: {
        single: Number(data.payout_multiplier_single),
        double: Number(data.payout_multiplier_double),
        triple: Number(data.payout_multiplier_triple),
      },
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { multipliers: fallback, error: `Could not read payout multipliers: ${message}` }
  }
}

export async function updatePayoutMultipliersAction(multipliers: PayoutMultipliers) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { success: false, error: auth.error ?? 'Unauthorized' }

  const { single, double, triple } = multipliers
  // The database enforces `> 0` too (CHECK on game_config); validating here
  // just produces a friendlier message.
  if (![single, double, triple].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) {
    return { success: false, error: 'Each multiplier must be a positive number.' }
  }

  try {
    const { error } = await createAdminClient()
      .from('game_config')
      .update({
        payout_multiplier_single: single,
        payout_multiplier_double: double,
        payout_multiplier_triple: triple,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'global')
    if (error) throw new Error(error.message)

    await logAuditEventAction('system', `Payout multipliers set to x${single} / x${double} / x${triple}`)
    revalidatePath('/superadmin')
    return { success: true, multipliers, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: `Could not update payout multipliers: ${message}` }
  }
}

// Lightweight, poll-friendly round-timing check — used only to lock the
// Payout Multipliers widget in the closing seconds of a round. Deliberately
// separate from getLatestGameDrawsAction (which also fetches 20 rounds of
// nested bet history) since this needs to be polled every couple of seconds
// and that one does not.
//
// This lock is a UX/discipline convenience only, not a correctness
// requirement -- a change submitted at any point still only ever affects the
// next round (each round pins its own payout_multiplier_* at creation time,
// see draw_round/settle_round), so a stale or failed poll here fails open
// (unlocked) rather than risking the widget getting stuck disabled.
export async function getActiveRoundTimingAction(): Promise<{
  seconds_remaining: number | null
  round_number: number | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { seconds_remaining: null, round_number: null, error: auth.error }

  try {
    const db = createAdminClient()
    const { data: rawCur, error } = await db.rpc('get_current_round')
    if (error) throw new Error(error.message)
    const cur = asRpc<CurrentRound | null>(rawCur)
    return {
      seconds_remaining: cur ? Number(cur.seconds_remaining) : null,
      round_number: cur ? Number(cur.round_number) : null,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { seconds_remaining: null, round_number: null, error: `Could not read round timing: ${message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE GAME TELEMETRY
// ─────────────────────────────────────────────────────────────────────────────
export interface DrawRow {
  round_id: string
  round_number: number
  hand_id: string
  red: number
  green: number
  black: number
  result: string
  total_stake: number
  total_payout: number
  player_count: number
  outcome: 'WON' | 'LOST' | 'NO BETS'
  created_at: string
  player_bets: Array<{ username: string; total_stake: number; total_payout: number }>
}

export async function getLatestGameDrawsAction(): Promise<{
  draws: DrawRow[]
  active_round: {
    round_number: number
    round_id: string
    phase: string
    seconds_remaining: number
    seconds_into: number
    draw_at_second: number
    has_digits: boolean
    red: number | null
    green: number | null
    black: number | null
  } | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { draws: [], active_round: null, error: auth.error }

  try {
    const db = createAdminClient()

    const roundsRes = await db
      .from('rounds')
      .select(`id, round_number, red, green, black, total_stake, total_payout,
               scheduled_at, drawn_at,
               bets ( total_stake, total_payout, profiles:user_id ( username ) )`)
      .not('red', 'is', null)
      .order('round_number', { ascending: false })
      .limit(20)
    if (roundsRes.error) throw new Error(`rounds: ${roundsRes.error.message}`)

    const draws: DrawRow[] = (roundsRes.data ?? []).map(r => {
      const bets = (r as unknown as {
        bets: Array<{ total_stake: number; total_payout: number; profiles: { username: string } | null }>
      }).bets ?? []

      const player_bets = bets.map(b => ({
        username: b.profiles?.username ?? 'player',
        total_stake: Number(b.total_stake ?? 0),
        // settle_round() writes the authoritative payout, so nothing is
        // recomputed here. v1 recalculated in three separate places, each with
        // its own key-format fallbacks.
        total_payout: Number(b.total_payout ?? 0),
      }))

      const stake = player_bets.reduce((s, b) => s + b.total_stake, 0)
      const payout = player_bets.reduce((s, b) => s + b.total_payout, 0)

      return {
        round_id: r.id,
        round_number: Number(r.round_number),
        hand_id: `...${String(r.id).slice(-8)}`,
        red: Number(r.red), green: Number(r.green), black: Number(r.black),
        result: `${r.red}${r.green}${r.black}`,
        total_stake: stake,
        total_payout: payout,
        player_count: player_bets.length,
        outcome: player_bets.length === 0 ? 'NO BETS' : payout > 0 ? 'WON' : 'LOST',
        created_at: r.drawn_at ?? r.scheduled_at,
        player_bets,
      }
    })

    // Current round telemetry. get_current_round() only reveals digits once the
    // betting window has closed, so this cannot leak an outcome even to an
    // admin screen that is polling every 5 seconds.
    const { data: rawCur, error: curError } = await db.rpc('get_current_round')
    if (curError) throw new Error(`current round: ${curError.message}`)
    const cur = asRpc<CurrentRound | null>(rawCur)

    const hasDigits = cur?.red !== null && cur?.red !== undefined
    return {
      draws,
      active_round: cur ? {
        round_number: Number(cur.round_number),
        round_id: cur.round_id,
        phase: cur.phase,
        seconds_remaining: Number(cur.seconds_remaining),
        seconds_into: Number(cur.seconds_into),
        draw_at_second: Number(cur.draw_at_second),
        has_digits: hasDigits,
        red: hasDigits ? Number(cur.red) : null,
        green: hasDigits ? Number(cur.green) : null,
        black: hasDigits ? Number(cur.black) : null,
      } : null,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { draws: [], active_round: null, error: `Could not load telemetry: ${message}` }
  }
}
