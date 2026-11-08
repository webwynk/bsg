/**
 * Tests for agent-commission.ts. Node's built-in runner (Node 24 runs .ts directly):
 *   node --test src/lib/agent-commission.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as C from './agent-commission.ts'

test("Hasan's three examples (2026-11-08): Final = P&L - commission, always", () => {
  // bets 6,000, won 5,000, 5% -> P&L +1,000, commission 300, final +700
  assert.deepEqual(C.commissionLines({ plays: 1, stake: 6000, payout: 5000, commission: 300 }), { stake: 6000, payout: 5000, pnl: 1000, commission: 300, final: 700 })
  // bets 6,000, won 7,000, 5% -> P&L -1,000, commission 300, final -1,300
  assert.deepEqual(C.commissionLines({ plays: 1, stake: 6000, payout: 7000, commission: 300 }), { stake: 6000, payout: 7000, pnl: -1000, commission: 300, final: -1300 })
  // bets 6,000, won 6,000 (tie), 5% -> P&L 0, commission 300, final -300
  assert.deepEqual(C.commissionLines({ plays: 1, stake: 6000, payout: 6000, commission: 300 }), { stake: 6000, payout: 6000, pnl: 0, commission: 300, final: -300 })
})

test('small P&L both ways, a profit smaller than the commission turns negative, no commission = P&L', () => {
  assert.equal(C.finalFigure(300, 500), -200)
  assert.equal(C.finalFigure(-300, 500), -800)
  assert.equal(C.finalFigure(0, 500), -500)
  assert.equal(C.finalFigure(-1200, 0), -1200)
  assert.equal(C.finalFigure(0, 0), 0)
})

test('exact commission is rounded to 2 decimals only for display', () => {
  // 333 coins at 7.25% = 24.1425
  const l = C.commissionLines({ plays: 1, stake: 333, payout: 100, commission: 333 * 7.25 / 100 })
  assert.equal(l.commission, 24.14)
  assert.equal(l.final, 208.86) // 233 - 24.1425
  assert.equal(C.roundCoins(1.005), 1.01)
  assert.equal(C.roundCoins(-1.005), -1.01)
  assert.equal(C.roundCoins(0.1 + 0.2), 0.3)
})

test('the % typed in the Edit dialog: 0-100, at most 2 decimals', () => {
  assert.deepEqual(C.parseRatePct('5'), { pct: 5 })
  assert.deepEqual(C.parseRatePct(' 7.25 '), { pct: 7.25 })
  assert.deepEqual(C.parseRatePct('0'), { pct: 0 })
  assert.deepEqual(C.parseRatePct('100'), { pct: 100 })
  assert.deepEqual(C.parseRatePct(30), { pct: 30 })
  for (const bad of ['', '-1', '100.01', '101', '2.555', 'abc', '5%', '1e2', '.5']) assert.ok('error' in C.parseRatePct(bad), bad)
})

test('periods always show full dates', () => {
  assert.equal(C.periodText({ from: '2026-11-08', to: '2026-11-08' }, 'today'), 'Today: 8 Nov 2026')
  assert.equal(C.periodText({ from: '2026-11-02', to: '2026-11-08' }, '7d'), 'Last 7 days: 2 Nov 2026 – 8 Nov 2026')
  assert.equal(C.periodText({ from: '2026-10-10', to: '2026-11-08' }, '30d'), 'Last 30 days: 10 Oct 2026 – 8 Nov 2026')
  assert.equal(C.periodText({ from: '2026-11-01', to: '2026-11-05' }, null), '1 Nov 2026 – 5 Nov 2026')
  assert.equal(C.periodText({ from: '2026-12-31', to: '2027-01-02' }, null), '31 Dec 2026 – 2 Jan 2027')
  assert.equal(C.periodText(null, 'lifetime'), 'Lifetime (all time)')
})

test('rate summary: one %, a change inside the period, none set', () => {
  assert.equal(C.rateSummary([{ effectiveFrom: '2026-11-01', ratePct: 5 }]), '5%')
  assert.equal(C.rateSummary([{ effectiveFrom: '2026-11-01', ratePct: 5 }, { effectiveFrom: '2026-11-06', ratePct: 7.25 }]), '5% → 7.25% from 6 Nov 2026')
  assert.equal(C.rateSummary([], 0), '0%')
  assert.equal(C.rateSummary([], 7.5), '7.5%')
  assert.equal(C.rateChanged([{ effectiveFrom: '2026-11-01', ratePct: 5 }, { effectiveFrom: '2026-11-06', ratePct: 7.25 }]), true)
  assert.equal(C.rateChanged([{ effectiveFrom: '2026-11-01', ratePct: 5 }]), false)
  assert.equal(C.formatPct(7.5), '7.5%')
  assert.equal(C.formatPct(12.345), '12.35%')
})

test('reads the database answer, missing parts become 0 / empty', () => {
  const r = C.readCommissionReport({
    totals: { plays: 3, stake: '10000', payout: 8000, commission: '500.0000' },
    days: [{ day: '2026-11-07', plays: 3, stake: 10000, payout: 8000, rate_pct: '5.00', commission: '500' }],
    games: { lucky_card: { plays: 3, stake: 10000, payout: 8000, commission: 500 } },
    rates: [{ effective_from: '2026-11-01', rate_pct: '5.00' }],
    current_rate_pct: '5.00',
  })
  assert.deepEqual(r.totals, { plays: 3, stake: 10000, payout: 8000, commission: 500 })
  assert.deepEqual(r.days[0], { day: '2026-11-07', ratePct: 5, plays: 3, stake: 10000, payout: 8000, commission: 500 })
  assert.deepEqual(r.games.triple_chance, { plays: 0, stake: 0, payout: 0, commission: 0 })
  assert.equal(r.games.lucky_card.commission, 500)
  assert.deepEqual(r.rates, [{ effectiveFrom: '2026-11-01', ratePct: 5 }])
  assert.equal(r.currentRatePct, 5)
  assert.deepEqual(C.readCommissionReport(null), C.EMPTY_COMMISSION_REPORT)
})
