/**
 * Tests for money-totals-logic.ts. No test framework is installed in this
 * project, so these use Node's built-in runner (Node 24 runs .ts directly):
 *
 *   node --test src/lib/money-totals-logic.test.ts
 *
 * The import carries a .ts extension because Node needs it; TypeScript does not
 * allow that spelling without a compiler option the project does not set, hence
 * the expected error on that one line.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as M from './money-totals-logic.ts'

const answer = {
  lifetime: {
    triple_chance: { bets: 9508, stake: 10228697, payout: 9183398 },
    lucky_card: { bets: 6, stake: 8930, payout: 10750 },
  },
  today: {
    triple_chance: { bets: 40, stake: 8000, payout: 7200 },
    lucky_card: { bets: 12, stake: 1500, payout: 1800 },
  },
  window: {
    triple_chance: { bets: '3', stake: '300', payout: '100' },
    lucky_card: { bets: 1, stake: 50, payout: 0 },
  },
}

test('readMoneySummary reads all three windows of both games', () => {
  const s = M.readMoneySummary(answer)
  assert.deepEqual(s.lifetime.triple_chance, { bets: 9508, stake: 10228697, payout: 9183398 })
  assert.deepEqual(s.lifetime.lucky_card, { bets: 6, stake: 8930, payout: 10750 })
  assert.deepEqual(s.today.triple_chance, { bets: 40, stake: 8000, payout: 7200 })
  assert.deepEqual(s.today.lucky_card, { bets: 12, stake: 1500, payout: 1800 })
  assert.deepEqual(s.window.lucky_card, { bets: 1, stake: 50, payout: 0 })
})

test('readMoneySummary turns numbers sent as text into numbers', () => {
  const s = M.readMoneySummary(answer)
  assert.deepEqual(s.window.triple_chance, { bets: 3, stake: 300, payout: 100 })
  assert.equal(typeof s.window.triple_chance.stake, 'number')
})

test('readMoneySummary: anything missing or broken is 0, never a crash', () => {
  assert.deepEqual(M.readMoneySummary(null), M.EMPTY_MONEY_SUMMARY)
  assert.deepEqual(M.readMoneySummary(undefined), M.EMPTY_MONEY_SUMMARY)
  assert.deepEqual(M.readMoneySummary({}), M.EMPTY_MONEY_SUMMARY)
  assert.deepEqual(M.readMoneySummary('nonsense'), M.EMPTY_MONEY_SUMMARY)
  const partial = M.readMoneySummary({ lifetime: { lucky_card: { bets: 2, stake: 'x', payout: null } } })
  assert.deepEqual(partial.lifetime.lucky_card, { bets: 2, stake: 0, payout: 0 })
  assert.deepEqual(partial.lifetime.triple_chance, { bets: 0, stake: 0, payout: 0 })
  assert.deepEqual(partial.today, M.EMPTY_MONEY_BY_GAME)
})

test('the windows are not mixed up', () => {
  const s = M.readMoneySummary(answer)
  assert.equal(s.lifetime.triple_chance.bets, 9508)
  assert.equal(s.today.triple_chance.bets, 40)
  assert.equal(s.window.triple_chance.bets, 3)
})

test('combineGames adds the two games', () => {
  const s = M.readMoneySummary(answer)
  assert.deepEqual(M.combineGames(s.today), { bets: 52, stake: 9500, payout: 9000 })
  assert.deepEqual(M.combineGames(s.lifetime), { bets: 9514, stake: 10237627, payout: 9194148 })
  assert.deepEqual(M.combineGames(M.EMPTY_MONEY_BY_GAME), { bets: 0, stake: 0, payout: 0 })
})

test('houseResult is stake minus payout, and negative when players won more', () => {
  assert.equal(M.houseResult({ bets: 1, stake: 8000, payout: 7200 }), 800)
  assert.equal(M.houseResult({ bets: 1, stake: 1500, payout: 1800 }), -300)
  assert.equal(M.houseResult({ bets: 0, stake: 0, payout: 0 }), 0)
})

test('marginPct is the house result as a percentage of the stake, 0 when nothing was bet', () => {
  assert.equal(M.marginPct({ bets: 1, stake: 8000, payout: 7200 }), 10)
  assert.equal(M.marginPct({ bets: 1, stake: 1500, payout: 1800 }), -20)
  assert.equal(M.marginPct({ bets: 0, stake: 0, payout: 0 }), 0)
  assert.equal(M.marginPct({ bets: 3, stake: 0, payout: 5 }), 0)
})

test('readPlayerMoneyRows reads rows, text numbers and a missing last-played time', () => {
  const rows = M.readPlayerMoneyRows([
    { user_id: 'u1', plays: '79', stake: 174196, payout: '171733', last_played_at: '2026-10-06T18:00:49.781793+00:00' },
    { user_id: 'u2', plays: 2, stake: 20, payout: 0, last_played_at: null },
    { user_id: 'u3' },
  ])
  assert.deepEqual(rows[0], { user_id: 'u1', plays: 79, stake: 174196, payout: 171733, last_played_at: '2026-10-06T18:00:49.781793+00:00' })
  assert.deepEqual(rows[1], { user_id: 'u2', plays: 2, stake: 20, payout: 0, last_played_at: null })
  assert.deepEqual(rows[2], { user_id: 'u3', plays: 0, stake: 0, payout: 0, last_played_at: null })
})

test('readPlayerMoneyRows: not a list means no rows', () => {
  assert.deepEqual(M.readPlayerMoneyRows(null), [])
  assert.deepEqual(M.readPlayerMoneyRows(undefined), [])
  assert.deepEqual(M.readPlayerMoneyRows({}), [])
  assert.deepEqual(M.readPlayerMoneyRows([]), [])
})

test('formatSplitValue: counts, coins, signed coins and percentages', () => {
  assert.equal(M.formatSplitValue(9508, 'count'), '9508')
  assert.equal(M.formatSplitValue(0, 'count'), '0')
  assert.equal(M.formatSplitValue(8000, 'money'), '8,000')
  assert.equal(M.formatSplitValue(10228697, 'money'), '1,02,28,697')
  assert.equal(M.formatSplitValue(1234.5, 'money'), '1,234.5')
  assert.equal(M.formatSplitValue(800, 'signed'), '+800')
  assert.equal(M.formatSplitValue(0, 'signed'), '+0')
  assert.equal(M.formatSplitValue(-300, 'signed'), '-300')
  assert.equal(M.formatSplitValue(10, 'percent'), '10.0%')
  assert.equal(M.formatSplitValue(-20.04, 'percent'), '-20.0%')
  assert.equal(M.formatSplitValue(0, 'percent'), '0.0%')
})
