/**
 * Tests for spin2win-live-logic.ts. No test framework is installed in this
 * project, so these use Node's built-in runner (Node 24 runs .ts directly):
 *
 *   node --test src/app/superadmin/live-game/spin2win-live-logic.test.ts
 *
 * The import below carries a .ts extension because Node needs it; TypeScript
 * (tsc / next build) does not allow that spelling without a compiler option the
 * project does not set, hence the expected error on that one line.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as L from './spin2win-live-logic.ts'

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

test('constants are the agreed values', () => {
  assert.equal(L.S2W_RTP_MIN, 30)
  assert.equal(L.S2W_RTP_MAX, 100)
  assert.equal(L.S2W_RTP_STEP, 0.5)
  assert.deepEqual([...L.S2W_RTP_PRESETS], [30, 50, 70, 90, 95, 100])
  assert.equal(L.S2W_CYCLE_SECONDS, 100)
  assert.equal(L.S2W_DRAW_SECOND, 90)
  assert.equal(L.S2W_BOOST_LOCK_SECOND, 85)
  assert.equal(L.S2W_CONFIG_LOCK_SECOND, 88)
})

test('every preset is itself a valid RTP', () => {
  for (const p of L.S2W_RTP_PRESETS) assert.equal(L.isValidRtp(p), true, String(p))
})

test('isValidRtp: 30 to 100 inclusive, finite numbers only', () => {
  assert.equal(L.isValidRtp(30), true)
  assert.equal(L.isValidRtp(100), true)
  assert.equal(L.isValidRtp(96.5), true)
  assert.equal(L.isValidRtp(29.99), false)
  assert.equal(L.isValidRtp(100.01), false)
  for (const bad of [NaN, Infinity, '90', null, undefined]) assert.equal(L.isValidRtp(bad), false, String(bad))
})

// ---------------------------------------------------------------------------
// Clock and locks
// ---------------------------------------------------------------------------

test('currentSecondsInto: no reading stays null', () => {
  assert.equal(L.currentSecondsInto(null, 1000, 5000), null)
})

test('currentSecondsInto: counts forward from the fetch moment', () => {
  assert.equal(L.currentSecondsInto(10, 1_000, 4_000), 13)
  assert.equal(L.currentSecondsInto(10, 1_000, 1_500), 10.5)
})

test('currentSecondsInto: clock not started or gone backwards gives the raw value', () => {
  assert.equal(L.currentSecondsInto(42, 0, 5_000), 42)
  assert.equal(L.currentSecondsInto(42, 5_000, 4_000), 42)
})

test('currentSecondsInto: wraps at the 100-second cycle (a new round)', () => {
  assert.equal(L.currentSecondsInto(95, 1_000, 11_000), 5)
  assert.equal(L.currentSecondsInto(99, 1_000, 2_000), 0)
})

test('serverSecondsInto: epoch seconds mod 100', () => {
  assert.equal(L.serverSecondsInto(1_700_000_088_500), 88)
  assert.equal(L.serverSecondsInto(1_700_000_100_000), 0)
})

test('isConfigLocked: from second 88 to the end of the round; null fails open', () => {
  assert.equal(L.isConfigLocked(null), false)
  assert.equal(L.isConfigLocked(0), false)
  assert.equal(L.isConfigLocked(87.9), false)
  assert.equal(L.isConfigLocked(88), true)
  assert.equal(L.isConfigLocked(99.9), true)
})

test('isBoostLocked: from second 85, or at once when the round is drawn', () => {
  assert.equal(L.isBoostLocked(null, false), false)
  assert.equal(L.isBoostLocked(84.9, false), false)
  assert.equal(L.isBoostLocked(85, false), true)
  assert.equal(L.isBoostLocked(3, true), true)
  assert.equal(L.isBoostLocked(null, true), true)
})

test('the boost locks 3 seconds before the next-round settings', () => {
  assert.equal(L.S2W_CONFIG_LOCK_SECOND - L.S2W_BOOST_LOCK_SECOND, 3)
  assert.ok(L.S2W_CONFIG_LOCK_SECOND < L.S2W_DRAW_SECOND)
})

test('secondsUntilDraw: rounded, never negative', () => {
  assert.equal(L.secondsUntilDraw(0, 90), 90)
  assert.equal(L.secondsUntilDraw(80.4, 90), 10)
  assert.equal(L.secondsUntilDraw(90, 90), 0)
  assert.equal(L.secondsUntilDraw(95, 90), 0)
})

test('configLockMessage: a countdown only while the draw is still ahead', () => {
  assert.match(L.configLockMessage(2, false), /draw is in 2s/)
  assert.match(L.configLockMessage(0, false), /being drawn/)
  assert.match(L.configLockMessage(null, false), /being drawn/)
  assert.match(L.configLockMessage(2, true), /has been drawn/)
  for (const m of [L.configLockMessage(2, false), L.configLockMessage(0, true)]) {
    assert.match(m, /Unlocks automatically when the next round starts\./)
  }
})

// ---------------------------------------------------------------------------
// Bonus and RTP rating
// ---------------------------------------------------------------------------

test('bonusHeadline: live boost wins, else the queued next-round bonus', () => {
  assert.deepEqual(L.bonusHeadline(3, 2), { text: '3x', liveNow: true })
  assert.deepEqual(L.bonusHeadline(1, 2), { text: '2x', liveNow: false })
  assert.deepEqual(L.bonusHeadline(null, 1), { text: 'N', liveNow: false })
  assert.deepEqual(L.bonusHeadline(1, 1), { text: 'N', liveNow: false })
})

test('rtpRating tiers and edges of each tier', () => {
  assert.equal(L.rtpRating(30).tone, 'aggressive')
  assert.equal(L.rtpRating(91.5).tone, 'aggressive')
  assert.equal(L.rtpRating(92).tone, 'balanced')
  assert.equal(L.rtpRating(96.5).tone, 'balanced')
  assert.equal(L.rtpRating(97).tone, 'friendly')
  assert.equal(L.rtpRating(99.5).tone, 'friendly')
  assert.equal(L.rtpRating(100).tone, 'full')
})

test('rtpEdge: one decimal', () => {
  assert.equal(L.rtpEdge(96.5), '3.5')
  assert.equal(L.rtpEdge(100), '0.0')
  assert.equal(L.rtpEdge(30), '70.0')
})

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

const ROUND = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  round_number: '17000000',
  winning_number: 7,
  total_stake: '500',
  total_payout: '450',
  bonus_multiplier: 2,
  rtp_percentage: '90.00',
  scheduled_at: '2026-10-25T10:00:00Z',
  drawn_at: '2026-10-25T09:59:50Z',
  spin2win_bets: [{ count: 4 }],
}

test('shapeDraw: a won round', () => {
  assert.deepEqual(L.shapeDraw(ROUND), {
    roundId: ROUND.id,
    roundNumber: 17000000,
    winningNumber: 7,
    totalStake: 500,
    totalPayout: 450,
    playerCount: 4,
    outcome: 'WON',
    bonus: 2,
    rtp: 90,
    time: '2026-10-25T09:59:50Z',
  })
})

test('shapeDraw: lost, no bets, missing draw time, missing bet count', () => {
  assert.equal(L.shapeDraw({ ...ROUND, total_payout: 0 }).outcome, 'LOST')
  assert.equal(L.shapeDraw({ ...ROUND, spin2win_bets: [] }).outcome, 'NO BETS')
  assert.equal(L.shapeDraw({ ...ROUND, spin2win_bets: undefined }).playerCount, 0)
  assert.equal(L.shapeDraw({ ...ROUND, drawn_at: null }).time, ROUND.scheduled_at)
})

test('shapeDraw: winning number 0 is kept; an undrawn round has none', () => {
  assert.equal(L.shapeDraw({ ...ROUND, winning_number: 0 }).winningNumber, 0)
  const d = L.shapeDraw({ ...ROUND, winning_number: null, total_stake: null, total_payout: null, bonus_multiplier: null, rtp_percentage: null })
  assert.equal(d.winningNumber, null)
  assert.equal(d.totalStake, 0)
  assert.equal(d.totalPayout, 0)
  assert.equal(d.bonus, 1)
  assert.equal(d.rtp, 0)
})

test('drawOutcome', () => {
  assert.equal(L.drawOutcome(0, 0), 'NO BETS')
  assert.equal(L.drawOutcome(0, 100), 'NO BETS')
  assert.equal(L.drawOutcome(3, 0), 'LOST')
  assert.equal(L.drawOutcome(3, 1), 'WON')
})

test('shapePlayerBet: lists only the numbers bet on, marks the winner', () => {
  const bet = L.shapePlayerBet(
    { user_id: 'u', total_stake: '25', total_payout: '90', n0: 5, n2: '10', n7: 10, profiles: { username: 'raj' } },
    0
  )
  assert.equal(bet.username, 'raj')
  assert.equal(bet.totalStake, 25)
  assert.equal(bet.totalPayout, 90)
  assert.deepEqual(bet.numbers, [
    { number: 0, amount: 5, isWinner: true },
    { number: 2, amount: 10, isWinner: false },
    { number: 7, amount: 10, isWinner: false },
  ])
})

test('shapePlayerBet: no winner yet, no name, no bets', () => {
  const bet = L.shapePlayerBet({ user_id: 'u', total_stake: null, total_payout: null, profiles: null }, null)
  assert.equal(bet.username, 'player')
  assert.equal(bet.totalStake, 0)
  assert.deepEqual(bet.numbers, [])
})

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

test('drawMatchesQuery: round number, id, winning number', () => {
  const d = L.shapeDraw(ROUND)
  assert.equal(L.drawMatchesQuery(d, ''), true)
  assert.equal(L.drawMatchesQuery(d, '   '), true)
  assert.equal(L.drawMatchesQuery(d, '1700'), true)
  assert.equal(L.drawMatchesQuery(d, 'A1B2'), true)
  assert.equal(L.drawMatchesQuery(d, '7'), true)
  assert.equal(L.drawMatchesQuery(d, '5'), false)
  assert.equal(L.drawMatchesQuery({ ...d, winningNumber: null }, '5'), false)
})

test('filterDraws: by status and by search together', () => {
  const won = L.shapeDraw(ROUND)
  const lost = L.shapeDraw({ ...ROUND, id: 'b', round_number: 17000001, winning_number: 6, total_payout: 0 })
  const none = L.shapeDraw({ ...ROUND, id: 'c', round_number: 17000002, spin2win_bets: [] })
  const all = [won, lost, none]
  assert.equal(L.filterDraws(all, '', 'ALL').length, 3)
  assert.deepEqual(L.filterDraws(all, '', 'WON'), [won])
  assert.deepEqual(L.filterDraws(all, '', 'LOST'), [lost])
  assert.deepEqual(L.filterDraws(all, '', 'NO BETS'), [none])
  assert.deepEqual(L.filterDraws(all, '6', 'ALL'), [lost])
  assert.deepEqual(L.filterDraws(all, '6', 'WON'), [])
})

// ---------------------------------------------------------------------------
// Round in progress: the stake figure
// ---------------------------------------------------------------------------

test('sumBetStakes: adds numbers and numeric strings, skips missing and junk', () => {
  assert.equal(L.sumBetStakes(null), 0)
  assert.equal(L.sumBetStakes([]), 0)
  assert.equal(L.sumBetStakes([{ total_stake: 10 }, { total_stake: '25' }, { total_stake: null }]), 35)
  assert.equal(L.sumBetStakes([{ total_stake: 'abc' }, { total_stake: 5 }]), 5)
})

test('roundStakeDisplay: live sum before the draw, round total after it', () => {
  assert.deepEqual(L.roundStakeDisplay(false, 0, 120), { label: 'Staked so far', amount: 120 })
  assert.deepEqual(L.roundStakeDisplay(true, 150, 120), { label: 'Total staked', amount: 150 })
})
