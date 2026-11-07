/**
 * Tests for lucky16-live-logic.ts. No test framework is installed in this
 * project, so these use Node's built-in runner (Node 24 runs .ts directly):
 *
 *   node --test src/app/superadmin/live-game/lucky16-live-logic.test.ts
 *
 * The import below carries a .ts extension because Node needs it; TypeScript
 * (tsc / next build) does not allow that spelling without a compiler option the
 * project does not set, hence the expected error on that one line.
 *
 * The refusal tests are the server actions' own checks: the actions call these
 * functions before they write anything. The actions' sign-in check is
 * requireAuth(['superadmin']), the same call as the other games' actions.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as L from './lucky16-live-logic.ts'

test('constants are the agreed values', () => {
  assert.equal(L.L16_RTP_MIN, 30)
  assert.equal(L.L16_RTP_MAX, 100)
  assert.equal(L.L16_RTP_STEP, 0.5)
  assert.deepEqual([...L.L16_RTP_PRESETS], [30, 50, 70, 90, 95, 100])
  assert.equal(L.L16_CYCLE_SECONDS, 103)
  assert.equal(L.L16_BOOST_LOCK_SECOND, 85)
  assert.equal(L.L16_CONFIG_LOCK_SECOND, 88)
})

test('RTP: 30 to 100 only', () => {
  for (const ok of [30, 87.5, 90, 100]) assert.equal(L.isValidRtp(ok), true)
  for (const bad of [29.5, 100.5, NaN, Infinity, '90', null]) assert.equal(L.isValidRtp(bad), false, String(bad))
})

test('rtpRefusal: the range, then the lock', () => {
  assert.equal(L.rtpRefusal(90, 87), null)
  assert.equal(L.rtpRefusal(29, 10), 'RTP must be a number between 30 and 100.')
  assert.equal(L.rtpRefusal(101, 10), 'RTP must be a number between 30 and 100.')
  assert.match(String(L.rtpRefusal(90, 88)), /^Locked/)
})

test('nextBonusRefusal: 1 to 10, then the lock', () => {
  assert.equal(L.nextBonusRefusal(1, 87), null)
  assert.equal(L.nextBonusRefusal(10, 0), null)
  for (const bad of [0, 11, 2.5, '2', null]) assert.match(String(L.nextBonusRefusal(bad, 10)), /whole number/, String(bad))
  assert.match(String(L.nextBonusRefusal(2, 88)), /^Locked/)
})

test('boostRefusal: 1 to 10, only while betting is open', () => {
  assert.equal(L.boostRefusal(5, 84), null)
  assert.match(String(L.boostRefusal(5, 85)), /^Locked/)
  assert.match(String(L.boostRefusal(5, 102)), /^Locked/)
  assert.match(String(L.boostRefusal(11, 10)), /whole number/)
})

test('serverSecondsInto wraps at 103', () => {
  assert.equal(L.serverSecondsInto(0), 0)
  assert.equal(L.serverSecondsInto(102_999), 102)
  assert.equal(L.serverSecondsInto(103_000), 0)
})

test('currentSecondsInto counts forward and wraps; falls back when unread', () => {
  assert.equal(L.currentSecondsInto(null, 1000, 2000), null)
  assert.equal(L.currentSecondsInto(10, 0, 2000), 10)
  assert.equal(L.currentSecondsInto(10, 1000, 500), 10)
  assert.equal(L.currentSecondsInto(10, 1000, 3000), 12)
  assert.equal(L.currentSecondsInto(102, 1000, 3000), 1)
})

test('the screen locks match the server, and a missing reading stays open', () => {
  assert.equal(L.isConfigLocked(null), false)
  assert.equal(L.isConfigLocked(87.9), false)
  assert.equal(L.isConfigLocked(88), true)
  assert.equal(L.isBoostLocked(null, false), false)
  assert.equal(L.isBoostLocked(84.9, false), false)
  assert.equal(L.isBoostLocked(85, false), true)
  assert.equal(L.isBoostLocked(10, true), true, 'a drawn round is locked at once')
})

test('secondsUntilDraw and the lock line', () => {
  assert.equal(L.secondsUntilDraw(80, 89), 9)
  assert.equal(L.secondsUntilDraw(95, 89), 0)
  assert.match(L.configLockMessage(1, false), /in 1s/)
  assert.match(L.configLockMessage(0, false), /being drawn/)
  assert.match(L.configLockMessage(0, true), /has been drawn/)
})

test('the bonus headline: live now if boosted, else what is queued', () => {
  assert.deepEqual(L.bonusHeadline(5, 1), { text: '5X', liveNow: true })
  assert.deepEqual(L.bonusHeadline(1, 3), { text: '3X', liveNow: false })
  assert.deepEqual(L.bonusHeadline(null, 1), { text: 'N', liveNow: false })
})

test('roundStakeDisplay: the live sum before the draw, the round total after', () => {
  assert.deepEqual(L.roundStakeDisplay(false, 0, 120), { label: 'Staked so far', amount: 120 })
  assert.deepEqual(L.roundStakeDisplay(true, 200, 120), { label: 'Total staked', amount: 200 })
})

test('rtpRating and rtpEdge', () => {
  assert.equal(L.rtpRating(90).tone, 'aggressive')
  assert.equal(L.rtpRating(95).tone, 'balanced')
  assert.equal(L.rtpRating(99).tone, 'friendly')
  assert.equal(L.rtpRating(100).tone, 'full')
  assert.equal(L.rtpEdge(96.5), '3.5')
})

const row = {
  id: 'r1', round_number: '17403942', winning_rank: 'A', winning_suit: 'spades',
  total_stake: '500', total_payout: '1400', bonus_multiplier: 2, rtp_percentage: '90.00',
  scheduled_at: '2026-10-30T10:00:00Z', drawn_at: null, lucky16_bets: [{ count: 3 }],
}

test('shapeDraw reads an Ace and falls back to the schedule time', () => {
  const d = L.shapeDraw(row)
  assert.equal(d.card, 'A♠')
  assert.equal(d.roundNumber, 17403942)
  assert.equal(d.playerCount, 3)
  assert.equal(d.outcome, 'WON')
  assert.equal(d.time, row.scheduled_at)
})

test('drawOutcome', () => {
  assert.equal(L.drawOutcome(0, 0), 'NO BETS')
  assert.equal(L.drawOutcome(2, 0), 'LOST')
  assert.equal(L.drawOutcome(2, 10), 'WON')
})

test('shapePlayerBet lists only the cards bet on, with the winner marked', () => {
  const p = L.shapePlayerBet(
    { user_id: 'u', total_stake: 60, total_payout: 700, a_spades: 50, k_clubs: 10, profiles: { username: 'sam' } },
    'A', 'spades'
  )
  assert.equal(p.username, 'sam')
  assert.deepEqual(p.cards, [{ card: 'A♠', amount: 50, isWinner: true }, { card: 'K♣', amount: 10, isWinner: false }])
})

test('the ledger search finds the round, the id and an Ace', () => {
  const d = L.shapeDraw(row)
  for (const q of ['17403', 'r1', 'A♠', 'a spades', 'aspades', '']) assert.equal(L.drawMatchesQuery(d, q), true, q)
  assert.equal(L.drawMatchesQuery(d, 'K♠'), false)
  assert.equal(L.filterDraws([d], '', 'LOST').length, 0)
  assert.equal(L.filterDraws([d], '', 'WON').length, 1)
})
