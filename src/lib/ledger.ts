/**
 * Single source of truth for the coin ledger vocabulary and coin arithmetic.
 *
 * M-4 FIX: before this file, three different lists of transaction types were
 * maintained independently (the Flutter app, the agent feeds, the player detail
 * view). Between them they referenced nine values that no RPC has ever written
 * -- `admin_topup`, `game_bet`, `game_win`, `agent_credit`, `agent_debit`,
 * `deposit`, `withdraw`, `win_credit` -- while the database only ever inserts
 * the five below. Filters silently dropped rows they were written to catch.
 *
 * M-2 FIX: coins are whole units. Chip denominations are 2/5/10/50/100 and
 * every stake and payout in the game is an integer, but the cashier accepted
 * two decimal places while the Flutter client truncates balance with .toInt().
 * A 100.75 deposit displayed as 100 in the app, stranding the remainder.
 */

/** Every `transactions.type` value written by a database RPC. */
export const TXN_TYPES = [
  'bet_stake',        // submit_round_bet
  'win_payout',       // resolve_round_payouts, get_my_round_result
  'agent_topup',      // transfer_coins_agent_to_player, agent_topup_player
  'agent_deduct',     // withdraw_coins_player_to_agent, agent_deduct_player
  'admin_adjustment', // issue_agent_coins
] as const

export type TxnType = (typeof TXN_TYPES)[number]

/** Types that move coins between a cashier and an account (excludes gameplay). */
export const CASHIER_TXN_TYPES: readonly TxnType[] = [
  'agent_topup',
  'agent_deduct',
  'admin_adjustment',
]

/** Types that increase an account's balance. */
export const CREDIT_TXN_TYPES: readonly TxnType[] = ['agent_topup', 'win_payout']

/**
 * True when a transaction increased the account's balance.
 * `admin_adjustment` carries its direction in the sign of `amount`, so the
 * sign is authoritative and the type list is only a fallback for zero amounts.
 */
export function isCreditTxn(type: string, amount: number): boolean {
  if (amount !== 0) return amount > 0
  return (CREDIT_TXN_TYPES as readonly string[]).includes(type)
}

/** Human-readable label for a transaction type. */
export function txnTypeLabel(type: string): string {
  switch (type) {
    case 'bet_stake':        return 'Game Bet'
    case 'win_payout':       return 'Game Win'
    case 'agent_topup':      return 'Agent Top-up'
    case 'agent_deduct':     return 'Agent Deduction'
    case 'admin_adjustment': return 'Admin Adjustment'
    default:                 return type
  }
}

/**
 * Coerces a user-supplied coin amount to a positive whole number.
 * Returns null when the input is not a usable amount.
 */
export function toWholeCoins(amount: unknown): number | null {
  const n = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(n)) return null
  const whole = Math.floor(n)
  if (whole <= 0) return null
  return whole
}
