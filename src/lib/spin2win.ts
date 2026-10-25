/**
 * Spin2Win -- pure rules shared by every dashboard screen that shows the game
 * (the Live Game "Spin2Win" tab, the player-history panel on the agent and
 * superadmin pages). No imports, no React, no database: plain functions of
 * their arguments, tested on their own (spin2win.test.ts, run with
 * `node --test`). Lives in src/lib so the agent and superadmin portals do not
 * import from each other's folders.
 *
 * Kept separate from src/lib/lucky-card.ts on purpose: the small helpers both
 * games need (embeddedCount, paginate, relativeTime, istDayKey) are copied
 * here, not imported, so a change to one game can never move the other.
 *
 * The game: ten numbers 0 to 9, a player may put coins on any of them in one
 * bet; one number wins per round and pays the stake on it x 9 x the round's
 * bonus. The bonus multiplier is "N" (none, = 1) or 2x to 4x
 * (migration 20261024210000_spin2win_core_tables.sql, CHECK 1..4).
 */

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const S2W_NUMBERS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/** The ten stake columns of `spin2win_bets`, n0 .. n9, in number order. */
export const S2W_BET_COLUMNS: readonly string[] = S2W_NUMBERS.map(n => `n${n}`)

/** The number if `value` is a whole number 0 to 9; otherwise null (a round has
 *  no winning number until it is drawn). */
export function asWinningNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null
}

/** Each number's tile colour, the same as the app's
 *  (bsg_app/lib/widgets/spin2win/spin2win_palette.dart). */
const NUMBER_COLOR: readonly string[] = [
  '#00C8F0', // 0 cyan
  '#FF3155', // 1 red
  '#FFC928', // 2 gold
  '#19D96B', // 3 green
  '#853BFF', // 4 purple
  '#1677FF', // 5 blue
  '#FF3155', // 6 red
  '#FFB52E', // 7 gold
  '#853BFF', // 8 purple
  '#FF35C7', // 9 pink
]

/** The tile colour of a number 0 to 9; a neutral grey for anything else. */
export function numberColor(n: number): string {
  return NUMBER_COLOR[n] ?? '#6B7280'
}

// ---------------------------------------------------------------------------
// A bet row: the ten stake columns of `spin2win_bets`
// ---------------------------------------------------------------------------

export interface NumberStake {
  number: number
  /** Coins put on this number in the bet (0 when none). */
  amount: number
  /** True when this number is the round's winning number. */
  isWinner: boolean
}

/** All ten numbers of one bet, in order, with the coins put on each (0 for
 *  numbers not bet on) and the winner marked; with no result nothing is a winner. */
export function numberStakes(row: Record<string, unknown>, winningNumber: unknown): NumberStake[] {
  const winner = asWinningNumber(winningNumber)
  return S2W_NUMBERS.map(n => ({
    number: n,
    amount: Number(row[`n${n}`] ?? 0),
    isWinner: winner === n,
  }))
}

/** Only the numbers the player actually put coins on, in number order. */
export function stakedNumbers(row: Record<string, unknown>, winningNumber: unknown): NumberStake[] {
  return numberStakes(row, winningNumber).filter(s => s.amount > 0)
}

// ---------------------------------------------------------------------------
// Bonus
// ---------------------------------------------------------------------------

export const S2W_BONUS_MIN = 1
export const S2W_BONUS_MAX = 4

export function isValidBonus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= S2W_BONUS_MIN && value <= S2W_BONUS_MAX
}

/** 1 = "N" (no bonus); 2 to 4 = "2x".."4x" (the app's lower-case x). */
export function bonusLabel(multiplier: number): string {
  return multiplier <= 1 ? 'N' : `${multiplier}x`
}

export function bonusLabelLong(multiplier: number): string {
  return multiplier <= 1 ? 'N (no bonus)' : `${multiplier}x`
}

/** The bonus badge's two colours, top (light) to bottom (dark), the same as
 *  the app's spin2WinBonusShades. Anything but 2, 3, 4 gets N's colours. */
export function bonusColors(multiplier: number): { light: string; dark: string } {
  switch (multiplier) {
    case 2: return { light: '#6FF3FF', dark: '#0077A8' }
    case 3: return { light: '#7DFFAE', dark: '#0A9A45' }
    case 4: return { light: '#6FB0FF', dark: '#0A4FC4' }
    default: return { light: '#C7D3EE', dark: '#5A6A8E' }
  }
}

/** What one bet pays: the stake on the winning number x 9 x the bonus
 *  (spin2win_settle_round()'s rule). 0 with no result yet. */
export function betPayout(row: Record<string, unknown>, winningNumber: unknown, bonus: number): number {
  const winner = asWinningNumber(winningNumber)
  if (winner === null) return 0
  return Number(row[`n${winner}`] ?? 0) * 9 * bonus
}

// ---------------------------------------------------------------------------
// PostgREST helper (copied from lucky-card.ts, see the header)
// ---------------------------------------------------------------------------

/** The number out of PostgREST's embedded count (`spin2win_bets(count)` comes
 *  back as `[{ count: N }]`); 0 when it is missing or empty. */
export function embeddedCount(embedded: Array<{ count: number | string }> | null | undefined): number {
  return Number(embedded?.[0]?.count ?? 0)
}

// ---------------------------------------------------------------------------
// Paging and time helpers for the lists (copied from lucky-card.ts)
// ---------------------------------------------------------------------------

/** One page of a list: the page number is kept inside 1..totalPages, and an
 *  empty list still has one (empty) page. */
export function paginate<T>(items: T[], page: number, perPage: number): {
  items: T[]; page: number; totalPages: number
} {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage))
  const safePage = Math.min(Math.max(1, page), totalPages)
  return {
    items: items.slice((safePage - 1) * perPage, safePage * perPage),
    page: safePage,
    totalPages,
  }
}

/** "Just now" / "12s ago" / "3m ago" / "2h ago" (Triple Chance's wording).
 *  Under 5 seconds, and any negative value, read "Just now". */
export function relativeTime(diffSeconds: number): string {
  const s = Math.floor(diffSeconds)
  if (s >= 3600) return `${Math.floor(s / 3600)}h ago`
  if (s >= 60) return `${Math.floor(s / 60)}m ago`
  if (s >= 5) return `${s}s ago`
  return 'Just now'
}

// ---------------------------------------------------------------------------
// A player's Spin2Win plays (the player-history screens)
// ---------------------------------------------------------------------------

/** A row of `spin2win_bets` with its round embedded
 *  (`spin2win_rounds!inner(...)` comes back as one object under that key). */
export type PlayerSpin2WinBetRow = {
  round_id: string
  total_stake: number | string | null
  total_payout: number | string | null
  is_settled: boolean | null
  created_at: string
  spin2win_rounds: {
    round_number: number | string
    winning_number: number | string | null
    bonus_multiplier: number | string | null
  }
} & Record<string, unknown>

/** WON / LOST once the bet is settled; PENDING while its round is still open
 *  or not yet settled. */
export type PlayOutcome = 'WON' | 'LOST' | 'PENDING'

export interface PlayerSpin2WinPlay {
  /** The full round UUID, shown as the Hand ID like the other games' lists. */
  hand_id: string
  round_number: number
  /** The winning number 0 to 9, null until the round is drawn. */
  winning_number: number | null
  bonus_multiplier: number
  total_stake: number
  total_payout: number
  outcome: PlayOutcome
  is_settled: boolean
  /** Date and time for display (Indian time), as formatted by the caller. */
  created_at: string
  created_at_iso: string
  /** All ten numbers with the coins the player put on each. */
  stakes: NumberStake[]
  /** The numbers bet on as one line: "3: 50 · 7: 20". */
  picks: string
}

/** Lucky Card's rule: a settled bet that paid anything is WON. */
export function playOutcome(isSettled: boolean, totalPayout: number): PlayOutcome {
  if (!isSettled) return 'PENDING'
  return totalPayout > 0 ? 'WON' : 'LOST'
}

/** Shapes one database row for the screen. `formatTime` turns the ISO time into
 *  the display text (the server passes its Indian-time formatter). */
export function shapePlayerPlay(row: PlayerSpin2WinBetRow, formatTime: (iso: string) => string): PlayerSpin2WinPlay {
  // The embedded round normally arrives as one object; take the first if a
  // client ever returns it as a one-item list.
  const embedded = row.spin2win_rounds as PlayerSpin2WinBetRow['spin2win_rounds'] | PlayerSpin2WinBetRow['spin2win_rounds'][]
  const round = Array.isArray(embedded) ? embedded[0] : embedded
  const winner = asWinningNumber(round?.winning_number)
  const totalPayout = Number(row.total_payout ?? 0)
  // A bet counts as settled only when its round also has its number.
  const isSettled = Boolean(row.is_settled) && winner !== null
  return {
    hand_id: String(row.round_id),
    round_number: Number(round?.round_number ?? 0),
    winning_number: winner,
    bonus_multiplier: Number(round?.bonus_multiplier ?? 1),
    total_stake: Number(row.total_stake ?? 0),
    total_payout: totalPayout,
    outcome: playOutcome(isSettled, totalPayout),
    is_settled: isSettled,
    created_at: formatTime(row.created_at),
    created_at_iso: row.created_at,
    stakes: numberStakes(row, winner),
    picks: stakedNumbers(row, winner).map(s => `${s.number}: ${s.amount}`).join(' · '),
  }
}

/** The Indian-time calendar day of an instant, "2026-10-07" (the format the
 *  history pages use for their date filter; copied from lucky-card.ts). */
export function istDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

export type PlayOutcomeFilter = 'all' | 'WON' | 'LOST'

/** The page's date and WON/LOST filters. `dayKey` undefined = every day. A
 *  PENDING play only shows under "all". */
export function filterPlays(
  plays: PlayerSpin2WinPlay[],
  dayKey: string | undefined,
  outcome: PlayOutcomeFilter
): PlayerSpin2WinPlay[] {
  return plays.filter(p =>
    (dayKey === undefined || istDayKey(p.created_at_iso) === dayKey)
    && (outcome === 'all' || p.outcome === outcome)
  )
}

export interface PlaysSummary {
  totalPlays: number
  totalBet: number
  totalWin: number
  /** What the house kept: bet minus win (negative when players won more). */
  netGgr: number
  /** netGgr as a percentage of the bet (0 when nothing was bet). */
  marginPct: number
}

/**
 * The strip above the list: settled plays only (a bet still waiting for its
 * draw has a stake but no result yet, which would show as a false house win).
 * scope 'today' = plays of the given Indian-time day `todayKey`.
 */
export function summarizePlays(
  plays: PlayerSpin2WinPlay[],
  scope: 'today' | 'lifetime',
  todayKey: string
): PlaysSummary {
  const counted = plays.filter(p =>
    p.outcome !== 'PENDING' && (scope === 'lifetime' || istDayKey(p.created_at_iso) === todayKey)
  )
  const totalBet = counted.reduce((s, p) => s + p.total_stake, 0)
  const totalWin = counted.reduce((s, p) => s + p.total_payout, 0)
  const netGgr = totalBet - totalWin
  return {
    totalPlays: counted.length,
    totalBet,
    totalWin,
    netGgr,
    marginPct: totalBet > 0 ? (netGgr / totalBet) * 100 : 0,
  }
}
