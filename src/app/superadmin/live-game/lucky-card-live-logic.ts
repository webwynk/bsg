/**
 * Lucky Card -- pure rules for the Live Game "Lucky Card" tab.
 *
 * No React, no database: everything here is a plain function of its
 * arguments, so it can be tested on its own (lucky-card-live-logic.test.ts, run
 * with `node --test`) and reused by the tab (lucky-card-live.tsx) and its
 * server actions (lucky-card-actions.ts). The cards, the bonus labels, the
 * paging and the time wording are shared with the player-history screens and
 * live in src/lib/lucky-card.ts; this file imports from there.
 *
 * Mirrors the Triple Chance Live Game page's rules where the two games behave
 * the same (the lock seconds, the RTP rating tiers), with Lucky Card's own
 * ranges: RTP 30 to 100, bonus 1 to 10, a 103-second cycle (spec
 * LUCKY_CARD_GAME_SPEC.md 5, 6, 13.1, 17AN, 17AO).
 */

// The .ts extension is what Node's test runner needs; TypeScript does not allow
// that spelling without a compiler option the project does not set.
// @ts-expect-error TS5097: relative import with a .ts extension (see above).
import { asRank, asSuit, bonusLabel, cardName, embeddedCount, stakedCards, suitSymbol, type LcRank, type LcSuit } from '../../../lib/lucky-card.ts'

// ---------------------------------------------------------------------------
// Ranges and timing
// ---------------------------------------------------------------------------

export const LC_RTP_MIN = 30
export const LC_RTP_MAX = 100
export const LC_RTP_STEP = 0.5
export const LC_RTP_PRESETS: readonly number[] = [30, 50, 70, 90, 95, 100]

/** One round lasts 103 seconds on the server clock. The server's own
 *  seconds_into is `epoch seconds % 103`, so counting it forward on the screen
 *  and wrapping at 103 stays exact (a new round starts at the wrap). */
export const LC_CYCLE_SECONDS = 103

/** "This Round" boost buttons lock at this second of the round (Triple
 *  Chance's value). A convenience for the admin only: the database refuses a
 *  boost once the round is drawn, whatever the screen says. */
export const LC_BOOST_LOCK_SECOND = 75

/** The RTP card and the "Next Round" dial lock at this second (Triple
 *  Chance's value; its countdown 12 = 90 - 78). Also a convenience only: each
 *  round pins its own RTP and bonus when it is created. */
export const LC_CONFIG_LOCK_SECOND = 78

// ---------------------------------------------------------------------------
// Validation (the database enforces the same ranges; this gives a friendly message)
// ---------------------------------------------------------------------------

export function isValidRtp(value: unknown): value is number {
  // NaN and Infinity fail the range test, so no separate finite check is needed.
  return typeof value === 'number' && value >= LC_RTP_MIN && value <= LC_RTP_MAX
}

// ---------------------------------------------------------------------------
// Clock and locks
// ---------------------------------------------------------------------------

/**
 * The second of the round "now", counted forward from the last server reading.
 * `fetchedAt` and `now` are client clock readings in ms; 0 means "not read yet"
 * (the page starts its clock at 0 before the first tick). When either reading
 * is missing, or the clock went backwards, the raw server value is returned.
 * Wraps at the 103-second cycle, so a reading that has grown stale across a
 * round boundary shows the new round's early seconds (unlocked) instead of a
 * stuck lock.
 */
export function currentSecondsInto(
  secondsInto: number | null,
  fetchedAt: number,
  now: number
): number | null {
  if (secondsInto === null) return null
  if (fetchedAt <= 0 || now < fetchedAt) return secondsInto
  const counted = secondsInto + (now - fetchedAt) / 1000
  return counted % LC_CYCLE_SECONDS
}

/** RTP card and "Next Round" dial. Null reading = unlocked (fails open: a
 *  failed reading must never leave the controls stuck disabled). */
export function isConfigLocked(secondsInto: number | null): boolean {
  return secondsInto !== null && secondsInto >= LC_CONFIG_LOCK_SECOND
}

/** "This Round" boost. Locked from the lock second, or at once when the round
 *  is already drawn (that part is a real rule, not only a convenience). */
export function isBoostLocked(secondsInto: number | null, drawn: boolean): boolean {
  return drawn || (secondsInto !== null && secondsInto >= LC_BOOST_LOCK_SECOND)
}

/** Whole seconds until the draw, never negative. */
export function secondsUntilDraw(secondsInto: number, drawAtSecond: number): number {
  return Math.max(0, Math.round(drawAtSecond - secondsInto))
}

/**
 * The line shown while the RTP card and the "Next Round" dial are locked.
 * `untilDraw` is the whole seconds left to the draw (null when unknown). Once
 * the card is drawn, or the draw second has passed, a countdown would be
 * wrong ("in 0s"), so the text says what is actually happening instead.
 */
export function configLockMessage(untilDraw: number | null, drawn: boolean): string {
  const tail = 'Unlocks automatically when the next round starts.'
  if (drawn) return `Locked — this round has been drawn. ${tail}`
  if (untilDraw === null || untilDraw <= 0) return `Locked — the card is being drawn. ${tail}`
  return `Locked — the draw is in ${untilDraw}s. ${tail}`
}

// ---------------------------------------------------------------------------
// Bonus
// ---------------------------------------------------------------------------

/**
 * The headline badge of the bonus card: what is live now if the running round
 * is boosted, otherwise what is queued for the next round. (Same rule as the
 * Triple Chance card.)
 */
export function bonusHeadline(
  currentRoundBonus: number | null,
  nextRoundBonus: number
): { text: string; liveNow: boolean } {
  if (currentRoundBonus !== null && currentRoundBonus !== 1) {
    return { text: `${currentRoundBonus}X`, liveNow: true }
  }
  return { text: bonusLabel(nextRoundBonus), liveNow: false }
}

// ---------------------------------------------------------------------------
// RTP rating (Triple Chance's tiers and wording)
// ---------------------------------------------------------------------------

export type RtpTone = 'aggressive' | 'balanced' | 'friendly' | 'full'

export function rtpRating(rtp: number): { label: string; tone: RtpTone } {
  if (rtp < 92) return { label: 'Aggressive Yield', tone: 'aggressive' }
  if (rtp <= 96.5) return { label: 'Balanced (Recommended)', tone: 'balanced' }
  if (rtp < 100) return { label: 'Player Friendly', tone: 'friendly' }
  return { label: '100% Full Return', tone: 'full' }
}

/** The house edge, one decimal, as text: 96.5 -> "3.5". */
export function rtpEdge(rtp: number): string {
  return (100 - rtp).toFixed(1)
}

// ---------------------------------------------------------------------------
// Shaping database rows for the screen
// ---------------------------------------------------------------------------

/** A row of `lucky_card_rounds` as the actions read it, with the bet count
 *  embedded (`lucky_card_bets(count)` comes back as `[{ count: N }]`). */
export interface LuckyCardRoundRow {
  id: string
  round_number: number | string
  winning_rank: string | null
  winning_suit: string | null
  total_stake: number | string | null
  total_payout: number | string | null
  bonus_multiplier: number | string | null
  rtp_percentage: number | string | null
  scheduled_at: string
  drawn_at: string | null
  lucky_card_bets?: Array<{ count: number | string }> | null
}

export type DrawOutcome = 'WON' | 'LOST' | 'NO BETS'

export interface LuckyCardDraw {
  roundId: string
  roundNumber: number
  rank: LcRank | null
  suit: LcSuit | null
  /** "K♠", or null while the round has no result. */
  card: string | null
  totalStake: number
  totalPayout: number
  playerCount: number
  outcome: DrawOutcome
  /** The round's own pinned bonus (1 to 10). */
  bonus: number
  /** The round's own pinned RTP. */
  rtp: number
  /** When the card was drawn; the schedule time if the draw time is missing. */
  time: string
}

export function drawOutcome(playerCount: number, totalPayout: number): DrawOutcome {
  if (playerCount === 0) return 'NO BETS'
  return totalPayout > 0 ? 'WON' : 'LOST'
}

export function shapeDraw(row: LuckyCardRoundRow): LuckyCardDraw {
  const playerCount = embeddedCount(row.lucky_card_bets)
  const totalPayout = Number(row.total_payout ?? 0)
  return {
    roundId: row.id,
    roundNumber: Number(row.round_number),
    rank: asRank(row.winning_rank),
    suit: asSuit(row.winning_suit),
    card: cardName(row.winning_rank, row.winning_suit),
    totalStake: Number(row.total_stake ?? 0),
    totalPayout,
    playerCount,
    outcome: drawOutcome(playerCount, totalPayout),
    bonus: Number(row.bonus_multiplier ?? 1),
    rtp: Number(row.rtp_percentage ?? 0),
    time: row.drawn_at ?? row.scheduled_at,
  }
}

export type LuckyCardBetRow = {
  user_id: string
  total_stake: number | string | null
  total_payout: number | string | null
  profiles?: { username: string | null } | null
} & Record<string, unknown>

export interface LuckyCardPlayerBet {
  username: string
  totalStake: number
  totalPayout: number
  /** Only the cards this player put coins on, in column order. */
  cards: Array<{ card: string; amount: number; isWinner: boolean }>
}

export function shapePlayerBet(
  row: LuckyCardBetRow,
  winningRank: string | null,
  winningSuit: string | null
): LuckyCardPlayerBet {
  return {
    username: row.profiles?.username ?? 'player',
    totalStake: Number(row.total_stake ?? 0),
    totalPayout: Number(row.total_payout ?? 0),
    cards: stakedCards(row, winningRank, winningSuit).map(c => ({ card: c.card, amount: c.amount, isWinner: c.isWinner })),
  }
}

// ---------------------------------------------------------------------------
// Ledger search, filter, paging
// ---------------------------------------------------------------------------

export type DrawStatusFilter = 'ALL' | DrawOutcome

/** Matches the round number, the round id, or the card ("K♠", "k spades",
 *  "ks" are all found). An empty query matches everything. */
export function drawMatchesQuery(draw: LuckyCardDraw, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const cardWords = draw.rank && draw.suit
    ? [`${draw.rank}${draw.suit}`, `${draw.rank} ${draw.suit}`, `${draw.rank}${suitSymbol(draw.suit)}`]
    : []
  return String(draw.roundNumber).includes(q)
    || draw.roundId.toLowerCase().includes(q)
    || cardWords.some(w => w.toLowerCase().includes(q))
}

export function filterDraws(
  draws: LuckyCardDraw[],
  query: string,
  status: DrawStatusFilter
): LuckyCardDraw[] {
  return draws.filter(d => drawMatchesQuery(d, query) && (status === 'ALL' || d.outcome === status))
}
