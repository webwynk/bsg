/**
 * Tests for agent-statement-pdf.ts and the statement model it prints
 * (buildStatementModel in agent-commission.ts). Node's built-in runner:
 *   node --test src/lib/agent-statement-pdf.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jsPDF } from 'jspdf'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as P from './agent-statement-pdf.ts'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as C from './agent-commission.ts'

const LABELS = [
  { key: 'triple_chance', label: 'Triple Chance' }, { key: 'lucky_card', label: 'Lucky Card' },
  { key: 'spin2win', label: 'Spin2Win' }, { key: 'lucky16', label: 'Lucky 16 Card' },
] as const

test('file names carry the agent and the period', () => {
  assert.equal(C.agentStatementFileName('agent2', { from: '2026-11-02', to: '2026-11-08' }), 'agent2_PnL_2026-11-02_2026-11-08.pdf')
  assert.equal(C.agentStatementFileName('agent2', { from: '2026-11-08', to: '2026-11-08' }), 'agent2_PnL_2026-11-08.pdf')
  assert.equal(C.agentStatementFileName('agent2', null), 'agent2_PnL_lifetime.pdf')
  assert.equal(C.agentStatementFileName('a/b c', null), 'a_b_c_PnL_lifetime.pdf')
})

test('text and amounts survive the built-in PDF fonts', () => {
  assert.equal(P.pdfText('5% → 7.25% from 6 Nov 2026'), '5% -> 7.25% from 6 Nov 2026')
  assert.equal(P.pdfText('2 Nov 2026 – 8 Nov 2026 · −5,500'), '2 Nov 2026 - 8 Nov 2026 · -5,500')
  assert.equal(C.coins(135748), '1,35,748')
  assert.equal(C.signedCoins(-5500), '-5,500')
  assert.equal(C.signedCoins(2500), '+2,500')
  assert.equal(C.coins(333 * 7.25 / 100), '24.14')
  assert.equal(C.coins(20686.3), '20,686.30')
})

test("the statement model prints Hasan's example: Final = P&L - commission", () => {
  const r = { ...C.EMPTY_COMMISSION_REPORT, totals: { plays: 4, stake: 10000, payout: 15000, commission: 500 }, rates: [{ effectiveFrom: '2026-11-01', ratePct: 5 }], currentRatePct: 5 }
  const m = C.buildStatementModel(r, LABELS)
  assert.deepEqual(m.lines.map((l: { label: string; value: string }) => [l.label, l.value]), [['Bets (In)', '10,000'], ['Wins (Out)', '15,000'], ['P&L', '-5,000'], ['Agent commission', '500'], ['Final', '-5,500']])
  assert.equal(m.lines[4].hint, 'P&L - commission')
  assert.equal(m.lines[3].hint, '5% of bets')
  assert.equal(m.lines[4].tone, 'neg')
  assert.equal(m.rateNote, null)
  assert.equal(m.games.length, 4)
})

const day = (d: string, stake: number, payout: number, rate: number) => ({ day: d, plays: 3, stake, payout, ratePct: rate, commission: (stake * rate) / 100 })

test('builds a statement; a long day list continues on more pages with a footer on each', () => {
  const days = Array.from({ length: 45 }, (_, i) => day(`2026-10-${String(30 - (i % 30)).padStart(2, '0')}`, 10000 + i, 8000, i < 20 ? 7.25 : 5))
  const totals = days.reduce((a, d) => ({ plays: a.plays + d.plays, stake: a.stake + d.stake, payout: a.payout + d.payout, commission: a.commission + d.commission }), { plays: 0, stake: 0, payout: 0, commission: 0 })
  const report = { ...C.EMPTY_COMMISSION_REPORT, totals, days, games: { ...C.EMPTY_COMMISSION_REPORT.games, lucky_card: totals }, rates: [{ effectiveFrom: '2026-10-01', ratePct: 5 }, { effectiveFrom: '2026-10-11', ratePct: 7.25 }], currentRatePct: 7.25 }
  const model = C.buildStatementModel(report, LABELS)
  assert.ok(model.rateNote && model.rateNote.includes('5% → 7.25% from 11 Oct 2026'))
  const pdf = P.buildAgentStatementPdf(jsPDF, {
    agent: { fullName: 'Agent Two', username: 'agent2', accountCode: 'AG-1002' },
    period: 'Last 30 days: 1 Oct 2026 – 30 Oct 2026', generatedAt: '8 Nov 2026, 12:41 PM IST', generatedBy: 'superadmin @admin', model,
  })
  const pages = pdf.getNumberOfPages()
  assert.ok(pages >= 2, `pages: ${pages}`)
  const text = pdf.output()
  assert.ok(text.includes('Agent P&L Statement'))
  assert.ok(text.includes('Agent ID: AG-1002'))
  assert.ok(text.includes('5% -> 7.25% from 11 Oct 2026'))
  assert.ok(text.includes(`Page ${pages} of ${pages}`))
  assert.ok(text.includes('By day \\(continued\\)'))
})

test('an empty period still builds one page with "No plays"', () => {
  const pdf = P.buildAgentStatementPdf(jsPDF, {
    agent: { fullName: 'Agent Ten', username: 'agent10', accountCode: null },
    period: 'Today: 8 Nov 2026', generatedAt: '8 Nov 2026, 12:41 PM IST', generatedBy: 'agent @agent10',
    model: C.buildStatementModel(C.EMPTY_COMMISSION_REPORT, LABELS),
  })
  assert.equal(pdf.getNumberOfPages(), 1)
  const text = pdf.output()
  assert.ok(text.includes('No plays in this period.'))
  assert.ok(text.includes('Agent ID: -'))
})

test('a very long agent name and username are cut so they never run into the Agent ID', () => {
  const pdf = P.buildAgentStatementPdf(jsPDF, {
    agent: { fullName: 'Mohammad Abdul Rahman Chowdhury Siddiqui Khan Bahadur', username: 'a_really_long_agent_username_2026', accountCode: 'A102' },
    period: 'Today: 8 Nov 2026', generatedAt: '8 Nov 2026, 12:41 PM IST', generatedBy: 'superadmin',
    model: C.buildStatementModel(C.EMPTY_COMMISSION_REPORT, LABELS),
  })
  const text = pdf.output()
  assert.ok(text.includes('Agent ID: A102'))
  assert.ok(text.includes('...'))
  assert.ok(!text.includes('Siddiqui Khan Bahadur'))
})
