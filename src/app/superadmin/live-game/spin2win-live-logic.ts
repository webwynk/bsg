/**
 * Spin2Win -- pure rules for the Live Game "Spin2Win" tab.
 *
 * No React, no database: everything here is a plain function of its
 * arguments, so it can be tested on its own (spin2win-live-logic.test.ts, run
 * with `node --test`) and reused by the tab (spin2win-live.tsx) and its server
 * actions (spin2win-actions.ts). The numbers, the bonus labels, the paging and
 * the time wording live in src/lib/spin2win.ts; this file imports from there.
 *
 * Same shape as the Lucky Card tab's rules (lucky-card-live-logic.ts), with
 * Spin2Win's own values: RTP 30 to 100, bonus 1 to 4, a 100-second cycle, the
 * draw at second 90 and betting closed from second 88
 * (migrations 20261024210000 and 20261024250000).
 */

// The .ts extension is what Node's test runner needs; TypeScript does not allow
// that spelling without a compiler option the project does not set.
// @ts-expect-error TS5097: relative import with a .ts extension (see above).
import { asWinningNumber, bonusLabel, embeddedCount, stakedNumbers } from '../../../lib/spin2win.ts'

// ---------------------------------------------------------------------------
// Ranges and timing
// ---------------------------------------------------------------------------

export const S2W_RTP_MIN = 30
export const S2W_RTP_MAX = 100
export const S2W_RTP_STEP = 0.5
export const S2W_RTP_PRESETS: readonly number[] = [30, 50, 70, 90, 95, 100]

/** One round lasts 100 seconds on the server clock (round_number = epoch / 100).
 *  The server's own seconds_into is `epoch seconds % 100`, so counting it
 *  forward on the screen and wrapping at 100 stays exact (a new round starts
 *  at the wrap). */
export const S2W_CYCLE_SECONDS = 100

/** The second the number is drawn (spin2win_config.draw_at_second's default). */
export const S2W_DRAW_SECOND = 90

/** "This round" boost buttons lock at this second. A convenience for the admin
 *  only: the database refuses a boost once the round is drawn, whatever the
 *  screen says. */
export const S2W_BOOST_LOCK_SECOND = 85

/** The RTP card and the "Next round" bonus lock at this second (the bet
 *  cut-off, spin2win_config.bet_cutoff_second). Also a convenience: each round
 *  pins its own RTP and bonus when it is created. */
export const S2W_CONFIG_LOCK_SECOND = 88

// ---------------------------------------------------------------------------
// Validation (the database enforces the same ranges; this gives a friendly message)
// ---------------------------------------------------------------------------

export function isValidRtp(value: unknown): value is number {
  // NaN and Infinity fail the range test, so no separate finite check is needed.
  return typeof value === 'number' && value >= S2W_RTP_MIN && value <= S2W_RTP_MAX
}

// ---------------------------------------------------------------------------
// Clock and locks
// ---------------------------------------------------------------------------

/**
 * The second of the round "now", counted forward from the last server reading.
 * `fetchedAt` and `now` are client clock readings in ms; 0 means "not read yet"
 * (the page starts its clock at 0 before the first tick). When either reading
 * is missing, or the clock went backwards, the raw server value is returned.
 * Wraps at the 100-second cycle, so a reading that has grown stale across a
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
  return counted % S2W_CYCLE_SECONDS
}

/** The second of the round on the server clock right now, from epoch ms
 *  (the server actions use it for their own lock check). */
export function serverSecondsInto(nowMs: number): number {
  return Math.floor(nowMs / 1000) % S2W_CYCLE_SECONDS
}

/** RTP card and "Next round" bonus. Null reading = unlocked (fails open: a
 *  failed reading must never leave the controls stuck disabled). */
export function isConfigLocked(secondsInto: number | null): boolean {
  return secondsInto !== null && secondsInto >= S2W_CONFIG_LOCK_SECOND
}

/** "This round" boost. Locked from the lock second, or at once when the round
 *  is already drawn (that part is a real rule, not only a convenience). */
export function isBoostLocked(secondsInto: number | null, drawn: boolean): boolean {
  return drawn || (secondsInto !== null && secondsInto >= S2W_BOOST_LOCK_SECOND)
}

/** Whole seconds until the draw, never negative. */
export function secondsUntilDraw(secondsInto: number, drawAtSecond: number): number {
  return Math.max(0, Math.round(drawAtSecond - secondsInto))
}

/**
 * The line shown while the RTP card and the "Next round" bonus are locked.
 * `untilDraw` is the whole seconds left to the draw (null when unknown). Once
 * the number is drawn, or the draw second has passed, a countdown would be
 * wrong ("in 0s"), so the text says what is actually happening instead.
 */
export function configLockMessage(untilDraw: number | null, drawn: boolean): string {
  const tail = 'Unlocks automatically when the next round starts.'
  if (drawn) return `Locked — this round has been drawn. ${tail}`
  if (untilDraw === null || untilDraw <= 0) return `Locked — the number is being drawn. ${tail}`
  return `Locked — the draw is in ${untilDraw}s. ${tail}`
}

// ---------------------------------------------------------------------------
// Bonus
// ---------------------------------------------------------------------------

/**
 * The headline badge of the bonus card: what is live now if the running round
 * is boosted, otherwise what is queued for the next round. (Same rule as the
 * Lucky Card and Triple Chance cards.)
 */
export function bonusHeadline(
  currentRoundBonus: number | null,
  nextRoundBonus: number
): { text: string; liveNow: boolean } {
  if (currentRoundBonus !== null && currentRoundBonus !== 1) {
    return { text: bonusLabel(currentRoundBonus), liveNow: true }
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
// Round in progress: the stake figure
// ---------------------------------------------------------------------------

/**
 * Adds up the total_stake of a round's bet rows (each row's total_stake is kept
 * at n0 + ... + n9 as the player bets). Missing or non-numeric values count as 0.
 */
export function sumBetStakes(rows: ReadonlyArray<{ total_stake: number | string | null }> | null): number {
  if (!rows) return 0
  return rows.reduce((sum, r) => {
    const n = Number(r.total_stake ?? 0)
    return Number.isFinite(n) ? sum + n : sum
  }, 0)
}

/**
 * The stake figure on the round-in-progress card. Before the draw the round's
 * own total_stake is still 0, so the live sum of its bets is shown as "Staked
 * so far"; once drawn the round's own total (written by the draw) is the
 * authoritative figure, shown as "Total staked".
 */
export function roundStakeDisplay(
  drawn: boolean,
  roundTotalStake: number,
  liveStake: number
): { label: string; amount: number } {
  return drawn
    ? { label: 'Total staked', amount: roundTotalStake }
    : { label: 'Staked so far', amount: liveStake }
}

// ---------------------------------------------------------------------------
// Shaping database rows for the screen
// ---------------------------------------------------------------------------

/** A row of `spin2win_rounds` as the actions read it, with the bet count
 *  embedded (`spin2win_bets(count)` comes back as `[{ count: N }]`). */
export interface Spin2WinRoundRow {
  id: string
  round_number: number | string
  winning_number: number | string | null
  total_stake: number | string | null
  total_payout: number | string | null
  bonus_multiplier: number | string | null
  rtp_percentage: number | string | null
  scheduled_at: string
  drawn_at: string | null
  spin2win_bets?: Array<{ count: number | string }> | null
}

/** Same meaning as Lucky Card's: WON = the round paid players something,
 *  LOST = it paid nothing, NO BETS = nobody played. */
export type DrawOutcome = 'WON' | 'LOST' | 'NO BETS'

export interface Spin2WinDraw {
  roundId: string
  roundNumber: number
  /** 0 to 9, or null while the round has no result. */
  winningNumber: number | null
  totalStake: number
  totalPayout: number
  playerCount: number
  outcome: DrawOutcome
  /** The round's own pinned bonus (1 to 4). */
  bonus: number
  /** The round's own pinned RTP. */
  rtp: number
  /** When the number was drawn; the schedule time if the draw time is missing. */
  time: string
}

export function drawOutcome(playerCount: number, totalPayout: number): DrawOutcome {
  if (playerCount === 0) return 'NO BETS'
  return totalPayout > 0 ? 'WON' : 'LOST'
}

export function shapeDraw(row: Spin2WinRoundRow): Spin2WinDraw {
  const playerCount = embeddedCount(row.spin2win_bets)
  const totalPayout = Number(row.total_payout ?? 0)
  return {
    roundId: row.id,
    roundNumber: Number(row.round_number),
    winningNumber: asWinningNumber(row.winning_number),
    totalStake: Number(row.total_stake ?? 0),
    totalPayout,
    playerCount,
    outcome: drawOutcome(playerCount, totalPayout),
    bonus: Number(row.bonus_multiplier ?? 1),
    rtp: Number(row.rtp_percentage ?? 0),
    time: row.drawn_at ?? row.scheduled_at,
  }
}

export type Spin2WinBetRow = {
  user_id: string
  total_stake: number | string | null
  total_payout: number | string | null
  profiles?: { username: string | null } | null
} & Record<string, unknown>

export interface Spin2WinPlayerBet {
  username: string
  totalStake: number
  totalPayout: number
  /** Only the numbers this player put coins on, in number order. */
  numbers: Array<{ number: number; amount: number; isWinner: boolean }>
}

export function shapePlayerBet(row: Spin2WinBetRow, winningNumber: number | string | null): Spin2WinPlayerBet {
  return {
    username: row.profiles?.username ?? 'player',
    totalStake: Number(row.total_stake ?? 0),
    totalPayout: Number(row.total_payout ?? 0),
    numbers: stakedNumbers(row, winningNumber),
  }
}

// ---------------------------------------------------------------------------
// Ledger search, filter, paging
// ---------------------------------------------------------------------------

export type DrawStatusFilter = 'ALL' | DrawOutcome

/** Matches the round number, the round id, or the winning number (a single
 *  digit 0 to 9 also matches any round number containing it). An empty query
 *  matches everything. */
export function drawMatchesQuery(draw: Spin2WinDraw, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return String(draw.roundNumber).includes(q)
    || draw.roundId.toLowerCase().includes(q)
    || (draw.winningNumber !== null && String(draw.winningNumber) === q)
}

export function filterDraws(
  draws: Spin2WinDraw[],
  query: string,
  status: DrawStatusFilter
): Spin2WinDraw[] {
  return draws.filter(d => drawMatchesQuery(d, query) && (status === 'ALL' || d.outcome === status))
}
