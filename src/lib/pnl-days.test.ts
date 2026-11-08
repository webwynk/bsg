/**
 * Tests for pnl-days.ts. Node's built-in runner (Node 24 runs .ts directly):
 *   node --test src/lib/pnl-days.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as P from './pnl-days.ts'

const days = [
  { day: '2026-11-08', plays: 5, stake: 2000, payout: 1500 },
  { day: '2026-11-07', plays: 3, stake: 1000, payout: 4000 },
  { day: '2026-11-05', plays: 2, stake: 0, payout: 0 },
]

test('totals add every day up; net = bet - won; margin = net / bet', () => {
  assert.deepEqual(P.pnlTotals(days), { plays: 10, stake: 3000, payout: 5500, net: -2500, marginPct: (-2500 / 3000) * 100 })
  assert.deepEqual(P.pnlTotals([]), { plays: 0, stake: 0, payout: 0, net: 0, marginPct: 0 })
})

test('one day: house profit and margin, 0% when nothing was bet', () => {
  assert.deepEqual(P.dayNet({ stake: 2000, payout: 1500 }), { net: 500, marginPct: 25 })
  assert.deepEqual(P.dayNet({ stake: 1000, payout: 4000 }), { net: -3000, marginPct: -300 })
  assert.deepEqual(P.dayNet({ stake: 0, payout: 0 }), { net: 0, marginPct: 0 })
})

test('day labels show the IST day itself with its weekday', () => {
  assert.equal(P.dayLabel('2026-11-08'), '8 Nov 2026 · Sun')
  assert.equal(P.dayLabel('2026-11-07'), '7 Nov 2026 · Sat')
  assert.equal(P.dayLabel('2028-02-29'), '29 Feb 2028 · Tue')
  assert.equal(P.dayLabel('2027-01-01'), '1 Jan 2027 · Fri')
})

test('pages of 10, page clamped to the range', () => {
  const rows = Array.from({ length: 23 }, (_, i) => i)
  assert.deepEqual(P.pnlPage(rows, 1).items, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual(P.pnlPage(rows, 3), { items: [20, 21, 22], page: 3, totalPages: 3 })
  assert.equal(P.pnlPage(rows, 9).page, 3)
  assert.equal(P.pnlPage(rows, 0).page, 1)
  assert.deepEqual(P.pnlPage([], 1), { items: [], page: 1, totalPages: 1 })
})
