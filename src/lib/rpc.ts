/**
 * Typed contract for the database RPC surface.
 *
 * Every function in this file mirrors one `CREATE FUNCTION` in
 * supabase/migrations/20260807000200_rebuild_v2_functions.sql. The RPCs return
 * `jsonb`, which the generated types can only express as `Json`, so the shapes
 * are declared once here instead of being cast ad hoc at each call site.
 *
 * If you change an RPC's return shape in SQL, change it here in the same
 * commit — this file is the single place the two sides are reconciled.
 */

export interface CurrentRound {
  round_id: string
  round_number: number
  phase: 'betting' | 'drawing' | 'settled'
  scheduled_at: string
  seconds_remaining: number
  seconds_into: number
  draw_at_second: number
  /** Null until the draw, which happens strictly after the betting cutoff. */
  red: number | null
  green: number | null
  black: number | null
}

export interface PlaceBetResult {
  success: true
  total_stake: number
  coin_balance: number
  ledger_version: number
}

export interface MyRoundResult {
  placed_bet: boolean
  total_stake: number
  single_payout?: number
  double_payout?: number
  triple_payout?: number
  total_payout: number
  is_settled: boolean
  coin_balance: number
  ledger_version: number
}

export interface SessionLoginResult {
  allowed: boolean
  reason?: 'account_blocked' | 'session_active_elsewhere'
  seconds_until_free?: number
  user_id?: string
  username?: string
  role?: 'superadmin' | 'agent' | 'player'
  coin_balance?: number
  ledger_version?: number
}

export interface SessionHeartbeatResult {
  allowed: boolean
  reason?: 'account_blocked' | 'session_displaced'
  coin_balance?: number
  ledger_version?: number
}

export interface AgentTransferResult {
  success: true
  player_coin_balance: number
  agent_coin_balance: number
}

export interface AdminIssueResult {
  success: true
  agent_coin_balance: number
}

export interface SetAgentActiveResult {
  success: true
  is_active: boolean
  username: string
  cascaded_player_ids: string[]
}

/** Return shape of attempt_staff_login -- mirrors attempt_player_login's
 * contract, adapted for agent/superadmin accounts. */
export type StaffLoginAttemptResult =
  | { success: true }
  | { success: false; reason: 'account_blocked'; locked?: true }
  | { success: false; reason: 'invalid_credentials'; attempts_remaining: number }

/** Return shape of staff_session_login -- claims or refuses the single-device
 * seat for an agent/superadmin login. */
export type StaffSessionLoginResult =
  | { allowed: true }
  | { allowed: false; reason: 'account_blocked' | 'session_active_elsewhere' }

/** Return shape of staff_session_touch -- called from requireAuth on every
 * dashboard action to confirm this is still the claimed device. */
export type StaffSessionTouchResult = { valid: boolean }

export interface PlayLimits {
  single: { min: number; max: number }
  double: { min: number; max: number }
  triple: { min: number; max: number }
}

export interface RecentRound {
  round_id: string
  round_number: number
  red: number
  green: number
  black: number
  scheduled_at: string
}

/**
 * Narrows an RPC payload to its declared shape.
 *
 * Deliberately explicit rather than a blanket `as`: the double assertion makes
 * it obvious at the call site that the contract above is being trusted, so a
 * mismatch is a code review question rather than an invisible coercion.
 */
export function asRpc<T>(data: unknown): T {
  return data as unknown as T
}
