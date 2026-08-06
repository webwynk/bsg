/**
 * Single source of truth for the coin vocabulary.
 *
 * These names mirror the database exactly. `coin_ledger.kind` is constrained to
 * this list by a CHECK, so anything not here cannot exist — and anything here
 * cannot be silently dropped by a filter.
 *
 * v1 kept three divergent lists across the app and the dashboard, between them
 * referencing nine values no RPC ever wrote (`admin_topup`, `game_bet`,
 * `game_win`, `agent_credit`… ). Filters quietly discarded rows they were
 * written to catch.
 */

/** Every `coin_ledger.kind` the database can produce. Mirrors the CHECK. */
export const LEDGER_KINDS = [
  'stake',         // player wagers                      (negative)
  'stake_refund',  // bet reduced before the draw        (positive)
  'payout',        // player wins                        (positive)
  'agent_credit',  // agent -> player                    (positive)
  'agent_debit',   // player -> agent                    (negative)
  'admin_credit',  // superadmin -> agent                (positive)
  'admin_debit',   // agent -> superadmin                (negative)
] as const

export type LedgerKind = (typeof LEDGER_KINDS)[number]

/** Movements produced by gameplay rather than by a cashier. */
export const GAMEPLAY_KINDS: readonly LedgerKind[] = ['stake', 'stake_refund', 'payout']

/** Movements a cashier (agent or superadmin) initiates. */
export const CASHIER_KINDS: readonly LedgerKind[] = [
  'agent_credit',
  'agent_debit',
  'admin_credit',
  'admin_debit',
]

/**
 * True when a movement increased the account's balance.
 * The database guarantees the sign agrees with the kind
 * (constraint `ledger_sign_matches_kind`), so the sign is authoritative.
 */
export function isCredit(amount: number): boolean {
  return amount > 0
}

/** Human-readable label for a ledger kind. */
export function ledgerKindLabel(kind: string): string {
  switch (kind) {
    case 'stake':        return 'Bet Placed'
    case 'stake_refund': return 'Bet Refunded'
    case 'payout':       return 'Game Win'
    case 'agent_credit': return 'Agent Deposit'
    case 'agent_debit':  return 'Agent Withdrawal'
    case 'admin_credit': return 'Admin Deposit'
    case 'admin_debit':  return 'Admin Withdrawal'
    default:             return kind
  }
}

/** Direction argument accepted by the transfer RPCs. */
export type TransferDirection = 'credit' | 'debit'

/**
 * Coerces a user-supplied coin amount to a positive whole number.
 * Coins are integers everywhere: `coin_balance` is BIGINT and the chip
 * denominations are 2/5/10/50/100. Returns null when unusable.
 */
export function toWholeCoins(amount: unknown): number | null {
  const n = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(n)) return null
  const whole = Math.floor(n)
  return whole > 0 ? whole : null
}

/** Formats a coin amount for display (grouping only, no currency symbol). */
export function formatCoins(amount: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)
}
