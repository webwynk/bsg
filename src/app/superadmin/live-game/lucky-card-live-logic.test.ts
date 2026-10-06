/**
 * Tests for lucky-card-live-logic.ts. No test framework is installed in this
 * project, so these use Node's built-in runner (Node 24 runs .ts directly):
 *
 *   node --test src/app/superadmin/live-game/lucky-card-live-logic.test.ts
 *
 * The import below carries a .ts extension because Node needs it; TypeScript
 * (tsc / next build) does not allow that spelling without a compiler option the
 * project does not set, hence the expected error on that one line.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as L from './lucky-card-live-logic.ts'

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

test('constants are the agreed values', () => {
  assert.equal(L.LC_RTP_MIN, 30)
  assert.equal(L.LC_RTP_MAX, 100)
  assert.equal(L.LC_RTP_STEP, 0.5)
  assert.deepEqual([...L.LC_RTP_PRESETS], [30, 50, 70, 90, 95, 100])
  assert.equal(L.LC_CYCLE_SECONDS, 103)
  assert.equal(L.LC_BOOST_LOCK_SECOND, 75)
  assert.equal(L.LC_CONFIG_LOCK_SECOND, 78)
})

test('every preset is itself a valid RTP', () => {
  for (const p of L.LC_RTP_PRESETS) assert.equal(L.isValidRtp(p), true, String(p))
})

test('isValidRtp: 30 to 100 inclusive, finite numbers only', () => {
  assert.equal(L.isValidRtp(30), true)
  assert.equal(L.isValidRtp(100), true)
  assert.equal(L.isValidRtp(90), true)
  assert.equal(L.isValidRtp(96.5), true)
  assert.equal(L.isValidRtp(29.99), false)
  assert.equal(L.isValidRtp(100.01), false)
  assert.equal(L.isValidRtp(0), false)
  assert.equal(L.isValidRtp(-5), false)
  assert.equal(L.isValidRtp(NaN), false)
  assert.equal(L.isValidRtp(Infinity), false)
  assert.equal(L.isValidRtp('90'), false)
  assert.equal(L.isValidRtp(null), false)
  assert.equal(L.isValidRtp(undefined), false)
})

// ---------------------------------------------------------------------------
// Clock and locks
// ---------------------------------------------------------------------------

test('currentSecondsInto: no reading stays null', () => {
  assert.equal(L.currentSecondsInto(null, 1000, 5000), null)
})

test('currentSecondsInto: counts forward from the fetch moment', () => {
  assert.equal(L.currentSecondsInto(10, 1000, 3500), 12.5)
  assert.equal(L.currentSecondsInto(10, 1000, 1000), 10)
})

test('currentSecondsInto: clock not started or gone backwards gives the raw value', () => {
  assert.equal(L.currentSecondsInto(10, 0, 5000), 10)
  assert.equal(L.currentSecondsInto(10, 1000, 0), 10)
  assert.equal(L.currentSecondsInto(10, 5000, 4000), 10)
})

test('currentSecondsInto: wraps at the 103-second cycle (a new round)', () => {
  assert.equal(L.currentSecondsInto(100, 0 + 1, 1 + 5000), 2)
  assert.equal(L.currentSecondsInto(102, 1, 1 + 1000), 0)
  assert.equal(L.currentSecondsInto(102, 1, 1 + 500), 102.5)
})

test('isConfigLocked: from second 78 (countdown 12) to the end of the round', () => {
  assert.equal(L.isConfigLocked(null), false)
  assert.equal(L.isConfigLocked(0), false)
  assert.equal(L.isConfigLocked(77), false)
  assert.equal(L.isConfigLocked(77.99), false)
  assert.equal(L.isConfigLocked(78), true)
  assert.equal(L.isConfigLocked(89), true)
  assert.equal(L.isConfigLocked(102), true)
})

test('isConfigLocked agrees with Triple Chance\'s rule: the player countdown (90 minus the second, 0 to 90) is 12 or less', () => {
  for (let s = 0; s <= 102; s++) {
    const countdown = Math.max(0, Math.min(90, 90 - s))
    assert.equal(L.isConfigLocked(s), countdown <= 12, `second ${s}`)
  }
})

test('isBoostLocked: from second 75, or at once when the round is drawn', () => {
  assert.equal(L.isBoostLocked(null, false), false)
  assert.equal(L.isBoostLocked(0, false), false)
  assert.equal(L.isBoostLocked(74, false), false)
  assert.equal(L.isBoostLocked(74.99, false), false)
  assert.equal(L.isBoostLocked(75, false), true)
  assert.equal(L.isBoostLocked(100, false), true)
  assert.equal(L.isBoostLocked(10, true), true)
  assert.equal(L.isBoostLocked(null, true), true)
})

test('the boost locks 3 seconds before the next-round settings', () => {
  assert.equal(L.isBoostLocked(76, false), true)
  assert.equal(L.isConfigLocked(76), false)
  assert.equal(L.isBoostLocked(78, false), true)
  assert.equal(L.isConfigLocked(78), true)
})

test('secondsUntilDraw: rounded, never negative', () => {
  assert.equal(L.secondsUntilDraw(80, 89), 9)
  assert.equal(L.secondsUntilDraw(80.4, 89), 9)
  assert.equal(L.secondsUntilDraw(80.6, 89), 8)
  assert.equal(L.secondsUntilDraw(89, 89), 0)
  assert.equal(L.secondsUntilDraw(95, 89), 0)
})

test('configLockMessage: a countdown only while the draw is still ahead', () => {
  const tail = 'Unlocks automatically when the next round starts.'
  assert.equal(L.configLockMessage(9, false), `Locked — the draw is in 9s. ${tail}`)
  assert.equal(L.configLockMessage(1, false), `Locked — the draw is in 1s. ${tail}`)
  assert.equal(L.configLockMessage(0, false), `Locked — the card is being drawn. ${tail}`)
  assert.equal(L.configLockMessage(-3, false), `Locked — the card is being drawn. ${tail}`)
  assert.equal(L.configLockMessage(null, false), `Locked — the card is being drawn. ${tail}`)
  assert.equal(L.configLockMessage(9, true), `Locked — this round has been drawn. ${tail}`)
  assert.equal(L.configLockMessage(0, true), `Locked — this round has been drawn. ${tail}`)
  assert.equal(L.configLockMessage(null, true), `Locked — this round has been drawn. ${tail}`)
})

// ---------------------------------------------------------------------------
// Bonus
// ---------------------------------------------------------------------------

test('bonusHeadline: live boost wins, else the queued next-round bonus', () => {
  assert.deepEqual(L.bonusHeadline(5, 1), { text: '5X', liveNow: true })
  assert.deepEqual(L.bonusHeadline(5, 3), { text: '5X', liveNow: true })
  assert.deepEqual(L.bonusHeadline(1, 3), { text: '3X', liveNow: false })
  assert.deepEqual(L.bonusHeadline(1, 1), { text: 'N', liveNow: false })
  assert.deepEqual(L.bonusHeadline(null, 4), { text: '4X', liveNow: false })
  assert.deepEqual(L.bonusHeadline(null, 1), { text: 'N', liveNow: false })
})

// ---------------------------------------------------------------------------
// RTP rating
// ---------------------------------------------------------------------------

test('rtpRating tiers and edges of each tier', () => {
  assert.deepEqual(L.rtpRating(30), { label: 'Aggressive Yield', tone: 'aggressive' })
  assert.deepEqual(L.rtpRating(90), { label: 'Aggressive Yield', tone: 'aggressive' })
  assert.deepEqual(L.rtpRating(91.5), { label: 'Aggressive Yield', tone: 'aggressive' })
  assert.deepEqual(L.rtpRating(92), { label: 'Balanced (Recommended)', tone: 'balanced' })
  assert.deepEqual(L.rtpRating(96.5), { label: 'Balanced (Recommended)', tone: 'balanced' })
  assert.deepEqual(L.rtpRating(97), { label: 'Player Friendly', tone: 'friendly' })
  assert.deepEqual(L.rtpRating(99.5), { label: 'Player Friendly', tone: 'friendly' })
  assert.deepEqual(L.rtpRating(100), { label: '100% Full Return', tone: 'full' })
})

test('rtpEdge: one decimal', () => {
  assert.equal(L.rtpEdge(96.5), '3.5')
  assert.equal(L.rtpEdge(90), '10.0')
  assert.equal(L.rtpEdge(100), '0.0')
  assert.equal(L.rtpEdge(30), '70.0')
})

// ---------------------------------------------------------------------------
// Shaping rows
// ---------------------------------------------------------------------------

const baseRow = {
  id: 'r-1',
  round_number: '17000001',
  winning_rank: 'K',
  winning_suit: 'spades',
  total_stake: '500',
  total_payout: 1200,
  bonus_multiplier: 3,
  rtp_percentage: '92.50',
  scheduled_at: '2026-10-06T10:00:00Z',
  drawn_at: '2026-10-06T10:01:29Z',
  lucky_card_bets: [{ count: 4 }],
}

test('shapeDraw: a won round', () => {
  assert.deepEqual(L.shapeDraw(baseRow), {
    roundId: 'r-1', roundNumber: 17000001, rank: 'K', suit: 'spades', card: 'K♠',
    totalStake: 500, totalPayout: 1200, playerCount: 4, outcome: 'WON',
    bonus: 3, rtp: 92.5, time: '2026-10-06T10:01:29Z',
  })
})

test('shapeDraw: lost, no bets, missing draw time, missing bet count', () => {
  assert.equal(L.shapeDraw({ ...baseRow, total_payout: 0 }).outcome, 'LOST')
  assert.equal(L.shapeDraw({ ...baseRow, lucky_card_bets: [{ count: 0 }], total_payout: 0 }).outcome, 'NO BETS')
  assert.equal(L.shapeDraw({ ...baseRow, lucky_card_bets: [] }).playerCount, 0)
  assert.equal(L.shapeDraw({ ...baseRow, lucky_card_bets: null }).playerCount, 0)
  const noDrawTime = L.shapeDraw({ ...baseRow, drawn_at: null })
  assert.equal(noDrawTime.time, '2026-10-06T10:00:00Z')
})

test('shapeDraw: an undrawn round has no card; empty fields become safe numbers', () => {
  const d = L.shapeDraw({
    ...baseRow, winning_rank: null, winning_suit: null,
    total_stake: null, total_payout: null, bonus_multiplier: null, rtp_percentage: null,
  })
  assert.equal(d.card, null)
  assert.equal(d.rank, null)
  assert.equal(d.suit, null)
  assert.equal(d.totalStake, 0)
  assert.equal(d.totalPayout, 0)
  assert.equal(d.bonus, 1)
  assert.equal(d.rtp, 0)
})

test('drawOutcome', () => {
  assert.equal(L.drawOutcome(0, 0), 'NO BETS')
  assert.equal(L.drawOutcome(0, 50), 'NO BETS')
  assert.equal(L.drawOutcome(3, 0), 'LOST')
  assert.equal(L.drawOutcome(3, 1), 'WON')
})

test('shapePlayerBet: lists only the cards bet on, marks the winner', () => {
  const p = L.shapePlayerBet({
    user_id: 'u1', total_stake: '70', total_payout: '150',
    profiles: { username: 'asha' },
    k_spades: 50, q_hearts: 20, j_clubs: 0,
  }, 'K', 'spades')
  assert.equal(p.username, 'asha')
  assert.equal(p.totalStake, 70)
  assert.equal(p.totalPayout, 150)
  assert.deepEqual(p.cards, [
    { card: 'Q♥', amount: 20, isWinner: false },
    { card: 'K♠', amount: 50, isWinner: true },
  ])
})

test('shapePlayerBet: no winner yet, no name, no bets', () => {
  const p = L.shapePlayerBet({ user_id: 'u2', total_stake: null, total_payout: null, profiles: null }, null, null)
  assert.equal(p.username, 'player')
  assert.equal(p.totalStake, 0)
  assert.deepEqual(p.cards, [])
  assert.equal(p.totalPayout, 0)
  const q = L.shapePlayerBet({ user_id: 'u3', total_stake: 5, total_payout: 0, profiles: { username: null }, j_hearts: 5 }, null, null)
  assert.equal(q.username, 'player')
  assert.deepEqual(q.cards, [{ card: 'J♥', amount: 5, isWinner: false }])
})

test('shapePlayerBet: the winner needs both rank and suit to match', () => {
  const p = L.shapePlayerBet({ user_id: 'u', total_stake: 10, total_payout: 0, k_hearts: 5, q_spades: 5 }, 'K', 'spades')
  assert.deepEqual(p.cards.map((c: { isWinner: boolean }) => c.isWinner), [false, false])
})

// ---------------------------------------------------------------------------
// Ledger search, filter, paging
// ---------------------------------------------------------------------------

const draws = [
  L.shapeDraw({ ...baseRow, id: 'aaa-111', round_number: 100 }),
  L.shapeDraw({ ...baseRow, id: 'bbb-222', round_number: 101, winning_rank: 'Q', winning_suit: 'hearts', total_payout: 0 }),
  L.shapeDraw({ ...baseRow, id: 'ccc-333', round_number: 102, lucky_card_bets: [], total_payout: 0 }),
]

test('drawMatchesQuery', () => {
  const [a, b] = draws
  assert.equal(L.drawMatchesQuery(a, ''), true)
  assert.equal(L.drawMatchesQuery(a, '   '), true)
  assert.equal(L.drawMatchesQuery(a, '100'), true)
  assert.equal(L.drawMatchesQuery(a, '101'), false)
  assert.equal(L.drawMatchesQuery(a, 'AAA'), true)
  assert.equal(L.drawMatchesQuery(a, 'K♠'), true)
  assert.equal(L.drawMatchesQuery(a, 'ks'), true)
  assert.equal(L.drawMatchesQuery(a, 'k spades'), true)
  assert.equal(L.drawMatchesQuery(a, 'kspades'), true)
  assert.equal(L.drawMatchesQuery(a, 'qh'), false)
  assert.equal(L.drawMatchesQuery(b, 'qh'), true)
  assert.equal(L.drawMatchesQuery(b, 'Q♥'), true)
  assert.equal(L.drawMatchesQuery(b, 'zzz'), false)
})

test('drawMatchesQuery: a round without a card can still be found by number', () => {
  const undrawn = L.shapeDraw({ ...baseRow, winning_rank: null, winning_suit: null, round_number: 555 })
  assert.equal(L.drawMatchesQuery(undrawn, '555'), true)
  assert.equal(L.drawMatchesQuery(undrawn, 'ks'), false)
})

test('filterDraws: by status and by search together', () => {
  assert.equal(L.filterDraws(draws, '', 'ALL').length, 3)
  assert.deepEqual(L.filterDraws(draws, '', 'WON').map((d: { roundNumber: number }) => d.roundNumber), [100])
  assert.deepEqual(L.filterDraws(draws, '', 'LOST').map((d: { roundNumber: number }) => d.roundNumber), [101])
  assert.deepEqual(L.filterDraws(draws, '', 'NO BETS').map((d: { roundNumber: number }) => d.roundNumber), [102])
  assert.deepEqual(L.filterDraws(draws, 'qh', 'LOST').map((d: { roundNumber: number }) => d.roundNumber), [101])
  assert.deepEqual(L.filterDraws(draws, 'qh', 'WON'), [])
})
