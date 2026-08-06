'use server'

import { createAdminClient } from '@/lib/supabase'

import { requireAuth } from '@/lib/auth-guard'
import { CASHIER_KINDS, isCredit, type LedgerKind } from '@/lib/ledger'

/**
 * Agent cashier dashboard data.
 *
 * v2 rewrite. Changes from v1 beyond the renames:
 *
 *  S-4  The `.or('agent_id.eq.X,parent_agent_id.eq.X')` filter is gone.
 *       `parent_agent_id` never existed, so every one of those queries returned
 *       42703, `data` came back null, and the code fell through to a fallback
 *       that reported balance 0. That was the "balance shows 0" bug. The
 *       hierarchy is one level, so `agent_id` alone is correct.
 *
 *  B-10 The "no bets today" fallback that summed **network-wide** bets is gone.
 *       An agent with no activity was shown another agent's numbers as if they
 *       were their own.
 *
 *  Errors are no longer swallowed. supabase-js returns `{ data: null, error }`
 *  rather than throwing, so silently ignoring `error` is what let three
 *  separate schema mismatches reach production.
 */


/** Start of today in Asia/Kolkata, as an ISO instant. */
function istDayStartISO(): string {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  return new Date(`${day}T00:00:00+05:30`).toISOString()
}

function istDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export interface AgentDashboardData {
  coin_balance: number
  username: string
  full_name: string
  joined_date: string
  players_count: number
  players: Array<{ id: string; full_name: string; username: string; coin_balance: number }>
  todays_stake: number
  todays_payout: number
  todays_profit: number
  recent_transfers: Array<{
    id: string
    direction: 'deposit' | 'withdraw'
    amount: number
    target_name: string
    target_username: string
    created_at: string
  }>
  error: string | null
}

const EMPTY: AgentDashboardData = {
  coin_balance: 0, username: '', full_name: '', joined_date: '',
  players_count: 0, players: [], todays_stake: 0, todays_payout: 0, todays_profit: 0,
  recent_transfers: [], error: null,
}

export async function getAgentDashboardDataAction(): Promise<AgentDashboardData> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { ...EMPTY, error: auth.error }

  const me = auth.user

  try {
    const db = createAdminClient()

    // Own profile + the players that report to me. One level of hierarchy.
    const [profileRes, playersRes] = await Promise.all([
      db.from('profiles')
        .select('username, full_name, coin_balance, created_at')
        .eq('id', me.id).single(),
      db.from('profiles')
        .select('id, username, full_name, coin_balance, is_active')
        .eq('agent_id', me.id)
        .order('username'),
    ])

    if (profileRes.error) throw new Error(`profile: ${profileRes.error.message}`)
    if (playersRes.error) throw new Error(`players: ${playersRes.error.message}`)

    const players = (playersRes.data ?? []).map(p => ({
      id: p.id,
      full_name: p.full_name || p.username,
      username: p.username,
      coin_balance: Number(p.coin_balance ?? 0),
    }))
    const playerIds = players.map(p => p.id)

    // Today's gameplay, scoped strictly to my own players.
    // B-10: no network-wide fallback. No players means zero, not someone else's
    // numbers.
    let todays_stake = 0
    let todays_payout = 0
    if (playerIds.length > 0) {
      const betsRes = await db
        .from('bets')
        .select('total_stake, total_payout')
        .in('user_id', playerIds)
        .gte('created_at', istDayStartISO())
      if (betsRes.error) throw new Error(`bets: ${betsRes.error.message}`)

      for (const b of betsRes.data ?? []) {
        todays_stake  += Number(b.total_stake  ?? 0)
        todays_payout += Number(b.total_payout ?? 0)
      }
    }

    // Recent cashier movements involving me or my players.
    const ledgerRes = await db
      .from('coin_ledger')
      .select('id, user_id, counterparty_id, kind, amount, created_at')
      .in('kind', CASHIER_KINDS as unknown as string[])
      .in('user_id', [me.id, ...playerIds])
      .order('created_at', { ascending: false })
      .limit(50)
    if (ledgerRes.error) throw new Error(`ledger: ${ledgerRes.error.message}`)

    const nameById = new Map(players.map(p => [p.id, p]))
    const recent_transfers = (ledgerRes.data ?? []).map(row => {
      const target = nameById.get(row.user_id)
      return {
        id: row.id,
        direction: (isCredit(Number(row.amount)) ? 'deposit' : 'withdraw') as 'deposit' | 'withdraw',
        amount: Math.abs(Number(row.amount)),
        target_name: target ? target.full_name : 'SuperAdmin',
        target_username: target ? `@${target.username}` : 'SuperAdmin',
        created_at: istDateTime(row.created_at),
      }
    })

    return {
      coin_balance: Number(profileRes.data.coin_balance ?? 0),
      username: profileRes.data.username,
      full_name: profileRes.data.full_name || profileRes.data.username,
      joined_date: new Date(profileRes.data.created_at).toLocaleDateString('en-US', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric',
      }),
      players_count: players.length,
      players,
      todays_stake,
      todays_payout,
      todays_profit: todays_stake - todays_payout,
      recent_transfers,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ...EMPTY, error: `Could not load dashboard: ${message}` }
  }
}

export interface AgentTransferHistory {
  coin_balance: number
  transfers: Array<{
    id: string
    category: 'superadmin' | 'player'
    direction: 'deposit' | 'withdraw'
    kind: LedgerKind
    amount: number
    balance_after: number
    target_name: string
    target_username: string
    created_at: string
    created_at_iso: string
  }>
  error: string | null
}

export async function getAgentTransactionHistoryAction(): Promise<AgentTransferHistory> {
  const auth = await requireAuth(['agent', 'superadmin'])
  if (auth.error || !auth.user) return { coin_balance: 0, transfers: [], error: auth.error }

  const me = auth.user

  try {
    const db = createAdminClient()

    const [profileRes, playersRes] = await Promise.all([
      db.from('profiles').select('coin_balance').eq('id', me.id).single(),
      db.from('profiles').select('id, username, full_name').eq('agent_id', me.id),
    ])
    if (profileRes.error) throw new Error(profileRes.error.message)
    if (playersRes.error) throw new Error(playersRes.error.message)

    const players = playersRes.data ?? []
    const playerIds = players.map(p => p.id)
    const nameById = new Map(players.map(p => [p.id, p]))

    const ledgerRes = await db
      .from('coin_ledger')
      .select('id, user_id, counterparty_id, kind, amount, balance_after, created_at')
      .in('kind', CASHIER_KINDS as unknown as string[])
      .in('user_id', [me.id, ...playerIds])
      .order('created_at', { ascending: false })
      .limit(200)
    if (ledgerRes.error) throw new Error(ledgerRes.error.message)

    const transfers = (ledgerRes.data ?? []).map(row => {
      const isMine = row.user_id === me.id
      const target = nameById.get(row.user_id)
      return {
        id: row.id,
        // Movements on my own balance came from the SuperAdmin; movements on a
        // player's balance are mine.
        category: (isMine ? 'superadmin' : 'player') as 'superadmin' | 'player',
        direction: (isCredit(Number(row.amount)) ? 'deposit' : 'withdraw') as 'deposit' | 'withdraw',
        kind: row.kind as LedgerKind,
        amount: Math.abs(Number(row.amount)),
        balance_after: Number(row.balance_after),
        target_name: isMine ? 'SuperAdmin' : (target?.full_name || target?.username || 'Player'),
        target_username: isMine ? 'SuperAdmin' : `@${target?.username ?? 'player'}`,
        created_at: istDateTime(row.created_at),
        created_at_iso: row.created_at,
      }
    })

    return { coin_balance: Number(profileRes.data.coin_balance ?? 0), transfers, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { coin_balance: 0, transfers: [], error: `Could not load history: ${message}` }
  }
}
