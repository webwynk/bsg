/**
 * Lucky Card -- pure rules shared by every dashboard screen that shows the game
 * (the Live Game "Lucky Card" tab, the player-history panel on the agent and
 * superadmin pages). No imports, no React, no database: plain functions of
 * their arguments, tested on their own (lucky-card.test.ts, run with
 * `node --test`). Lives in src/lib so the agent and superadmin portals do not
 * import from each other's folders.
 *
 * The game: 12 cards (J, Q, K of hearts, spades, diamonds, clubs), a player may
 * put coins on any of them in one bet; one card wins per round. The bonus
 * multiplier is "N" (none, = 1) or 2X to 10X (spec LUCKY_CARD_GAME_SPEC.md 5).
 */

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const LC_RANKS = ['J', 'Q', 'K'] as const
export const LC_SUITS = ['hearts', 'spades', 'diamonds', 'clubs'] as const

export type LcRank = (typeof LC_RANKS)[number]
export type LcSuit = (typeof LC_SUITS)[number]

const SUIT_SYMBOL: Record<LcSuit, string> = {
  hearts: '♥', spades: '♠', diamonds: '♦', clubs: '♣',
}

/** The rank if `value` is one of J, Q, K (exactly, upper case); otherwise null. */
export function asRank(value: unknown): LcRank | null {
  return (LC_RANKS as readonly unknown[]).includes(value) ? (value as LcRank) : null
}

/** The suit if `value` is one of the four suit names (exactly, lower case); otherwise null. */
export function asSuit(value: unknown): LcSuit | null {
  return (LC_SUITS as readonly unknown[]).includes(value) ? (value as LcSuit) : null
}

export function suitSymbol(suit: LcSuit): string {
  return SUIT_SYMBOL[suit]
}

export function suitIsRed(suit: LcSuit): boolean {
  return suit === 'hearts' || suit === 'diamonds'
}

/** "K♠". Null unless BOTH parts are a real rank and suit (a card arrives
 *  whole or not at all -- the database enforces the same). */
export function cardName(rank: unknown, suit: unknown): string | null {
  const r = asRank(rank)
  const s = asSuit(suit)
  return r && s ? `${r}${SUIT_SYMBOL[s]}` : null
}

// ---------------------------------------------------------------------------
// A bet row: the twelve stake columns of `lucky_card_bets`
// ---------------------------------------------------------------------------

/** The twelve stake columns, named `<rank>_<suit>` (j_hearts .. k_clubs), in the
 *  database's own order: ranks J, Q, K; within a rank hearts, spades, diamonds, clubs. */
export const LC_BET_COLUMNS: readonly string[] = LC_RANKS.flatMap(rank =>
  LC_SUITS.map(suit => `${rank.toLowerCase()}_${suit}`)
)

export interface CardStake {
  rank: LcRank
  suit: LcSuit
  /** "K♠". */
  card: string
  /** Coins put on this card in the bet (0 when none). */
  amount: number
  /** True when this card is the round's winning card. */
  isWinner: boolean
}

/**
 * All twelve cards of one bet, in column order, with the coins put on each (0
 * for cards not bet on) and the winner marked. The winner is marked only when
 * BOTH the rank and the suit match; with no result yet nothing is a winner.
 */
export function cardStakes(
  row: Record<string, unknown>,
  winningRank: unknown,
  winningSuit: unknown
): CardStake[] {
  const out: CardStake[] = []
  for (const rank of LC_RANKS) {
    for (const suit of LC_SUITS) {
      out.push({
        rank,
        suit,
        card: `${rank}${SUIT_SYMBOL[suit]}`,
        amount: Number(row[`${rank.toLowerCase()}_${suit}`] ?? 0),
        isWinner: rank === winningRank && suit === winningSuit,
      })
    }
  }
  return out
}

/** Only the cards the player actually put coins on, in column order. */
export function stakedCards(
  row: Record<string, unknown>,
  winningRank: unknown,
  winningSuit: unknown
): CardStake[] {
  return cardStakes(row, winningRank, winningSuit).filter(c => c.amount > 0)
}

// ---------------------------------------------------------------------------
// Bonus
// ---------------------------------------------------------------------------

export const LC_BONUS_MIN = 1
export const LC_BONUS_MAX = 10

export function isValidBonus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= LC_BONUS_MIN && value <= LC_BONUS_MAX
}

/** 1 = "N" (no bonus); 2 to 10 = "2X".."10X". */
export function bonusLabel(multiplier: number): string {
  return multiplier === 1 ? 'N' : `${multiplier}X`
}

export function bonusLabelLong(multiplier: number): string {
  return multiplier === 1 ? 'N (no bonus)' : `${multiplier}X`
}

// ---------------------------------------------------------------------------
// PostgREST helper
// ---------------------------------------------------------------------------

/** The number out of PostgREST's embedded count (`lucky_card_bets(count)` comes
 *  back as `[{ count: N }]`); 0 when it is missing or empty. */
export function embeddedCount(embedded: Array<{ count: number | string }> | null | undefined): number {
  return Number(embedded?.[0]?.count ?? 0)
}

// ---------------------------------------------------------------------------
// Paging and time helpers for the lists
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
// A player's Lucky Card plays (the player-history screens)
// ---------------------------------------------------------------------------

/** A row of `lucky_card_bets` with its round embedded
 *  (`lucky_card_rounds!inner(...)` comes back as one object under that key). */
export type PlayerLuckyCardBetRow = {
  round_id: string
  total_stake: number | string | null
  total_payout: number | string | null
  is_settled: boolean | null
  created_at: string
  lucky_card_rounds: {
    round_number: number | string
    winning_rank: string | null
    winning_suit: string | null
    bonus_multiplier: number | string | null
  }
} & Record<string, unknown>

/** WON / LOST once the bet is settled; PENDING while the round is still open
 *  or not yet settled (Triple Chance's list shows such a bet as LOST). */
export type PlayOutcome = 'WON' | 'LOST' | 'PENDING'

export interface PlayerLuckyCardPlay {
  /** The full round UUID, shown as the Hand ID like Triple Chance's list. */
  hand_id: string
  round_number: number
  /** The winning card "K♠", null until the round is drawn. */
  card: string | null
  rank: LcRank | null
  suit: LcSuit | null
  bonus_multiplier: number
  total_stake: number
  total_payout: number
  outcome: PlayOutcome
  is_settled: boolean
  /** Date and time for display (Indian time), as formatted by the caller. */
  created_at: string
  created_at_iso: string
  /** All twelve cards with the coins the player put on each. */
  stakes: CardStake[]
  /** The cards bet on as one line: "J♥ 50 · K♠ 20". */
  picks: string
}

export function playOutcome(isSettled: boolean, totalPayout: number): PlayOutcome {
  if (!isSettled) return 'PENDING'
  return totalPayout > 0 ? 'WON' : 'LOST'
}

/** Shapes one database row for the screen. `formatTime` turns the ISO time into
 *  the display text (the server passes its Indian-time formatter). */
export function shapePlayerPlay(row: PlayerLuckyCardBetRow, formatTime: (iso: string) => string): PlayerLuckyCardPlay {
  const round = row.lucky_card_rounds
  const rank = asRank(round.winning_rank)
  const suit = asSuit(round.winning_suit)
  const staked = stakedCards(row, round.winning_rank, round.winning_suit)
  const totalPayout = Number(row.total_payout ?? 0)
  // A bet counts as settled only when its round also has its card.
  const isSettled = Boolean(row.is_settled) && rank !== null && suit !== null
  return {
    hand_id: String(row.round_id),
    round_number: Number(round.round_number),
    card: cardName(round.winning_rank, round.winning_suit),
    rank,
    suit,
    bonus_multiplier: Number(round.bonus_multiplier ?? 1),
    total_stake: Number(row.total_stake ?? 0),
    total_payout: totalPayout,
    outcome: playOutcome(isSettled, totalPayout),
    is_settled: isSettled,
    created_at: formatTime(row.created_at),
    created_at_iso: row.created_at,
    stakes: cardStakes(row, round.winning_rank, round.winning_suit),
    picks: staked.map(c => `${c.card} ${c.amount}`).join(' · '),
  }
}

/** The Indian-time calendar day of an instant, "2026-10-07" (the format the
 *  history pages already use for their date filter). */
export function istDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

export type PlayOutcomeFilter = 'all' | 'WON' | 'LOST'

/** The date and WON/LOST filters shared with the Triple Chance list. `dayKey`
 *  undefined = every day. A PENDING play only shows under "all". */
export function filterPlays(
  plays: PlayerLuckyCardPlay[],
  dayKey: string | undefined,
  outcome: PlayOutcomeFilter
): PlayerLuckyCardPlay[] {
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
  plays: PlayerLuckyCardPlay[],
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
