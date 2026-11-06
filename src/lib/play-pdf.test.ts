/**
 * Tests for play-pdf.ts, drawing real PDFs. Node's built-in runner, as the other
 * lib tests. BSG_SAMPLE_PDFS=<folder> also writes the sample files there:
 *
 *   node --test src/lib/play-pdf.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import { ticketTokens } from './player-tickets.ts'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import { buildPlayPdf, playPdfFileName, playPdfGridHeight, playPdfPageHeight, planPdfTickets, wrapBoardText, type PdfSuit, type PlayPdfCell, type PlayPdfData } from './play-pdf.ts'

const SUITS: PdfSuit[] = ['hearts', 'spades', 'diamonds', 'clubs']

function cards(ranks: string[], amounts: Record<string, number>, winner: string): PlayPdfCell[] {
  return ranks.flatMap(rank => SUITS.map(suit => ({
    face: { kind: 'card' as const, rank, suit },
    amount: amounts[`${rank}${suit}`] ?? 0,
    isWinner: `${rank}${suit}` === winner,
  })))
}

const base = {
  createdAt: 'Nov 2, 2026, 12:20 AM',
  playerFullName: 'Sample Player',
  playerUsername: 'sample01',
  formatAmount: (n: number) => new Intl.NumberFormat('en-IN').format(n),
}

const samples: Record<string, PlayPdfData> = {
  lucky_card: {
    ...base, gameName: 'Lucky Card', roundLabel: 'LC-17413194', resultTitle: 'WINNING CARD',
    result: { kind: 'card', rank: 'Q', suit: 'hearts' }, bonusLabel: 'N',
    totalStake: 90, totalPayout: 0, outcome: 'LOST', gridTitle: 'COINS ON EACH CARD', gridColumns: 4,
    cells: cards(['J', 'Q', 'K'], { Jhearts: 10, Jspades: 20, Jdiamonds: 10, Jclubs: 10, Qspades: 10, Khearts: 5, Kspades: 15, Kdiamonds: 5, Kclubs: 5 }, 'Qhearts'),
  },
  lucky16: {
    ...base, gameName: 'Lucky 16 Card', roundLabel: 'LS-17413022', resultTitle: 'WINNING CARD',
    result: { kind: 'card', rank: 'K', suit: 'spades' }, bonusLabel: '2X',
    totalStake: 1320, totalPayout: 2800, outcome: 'WON', gridTitle: 'COINS ON EACH CARD', gridColumns: 4,
    cells: cards(['A', 'J', 'Q', 'K'], { Ahearts: 500, Kspades: 100, Qclubs: 720 }, 'Kspades'),
  },
  spin2win: {
    ...base, gameName: 'Spin2Win', roundLabel: 'SW-17737002', resultTitle: 'WINNING NUMBER',
    result: { kind: 'number', number: 7, color: '#16a34a' }, bonusLabel: '3x',
    totalStake: 150, totalPayout: 1350, outcome: 'WON', gridTitle: 'COINS ON EACH NUMBER', gridColumns: 5,
    cells: Array.from({ length: 10 }, (_, n) => ({
      face: { kind: 'number' as const, number: n, color: ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed'][n % 5] },
      amount: n === 7 ? 50 : n === 2 ? 100 : 0,
      isWinner: n === 7,
    })),
  },
}

describe('buildPlayPdf', () => {
  for (const [name, data] of Object.entries(samples)) {
    it(`draws one full page for ${name}`, () => {
      const pdf = buildPlayPdf(jsPDF, data)
      assert.equal(pdf.getNumberOfPages(), 1)
      assert.equal(Math.round(pdf.internal.pageSize.getWidth()), 800)
      assert.equal(Math.round(pdf.internal.pageSize.getHeight()), playPdfPageHeight(data.cells.length, data.gridColumns))
      const folder = process.env.BSG_SAMPLE_PDFS
      if (folder) writeFileSync(`${folder}/sample_${name}.pdf`, Buffer.from(pdf.output('arraybuffer')))
    })
  }

  it('handles a round not drawn yet, with nothing marked', () => {
    const pdf = buildPlayPdf(jsPDF, {
      ...samples.lucky_card, result: null, outcome: 'PENDING', totalPayout: 0,
      cells: samples.lucky_card.cells.map(c => ({ ...c, isWinner: false })),
    })
    assert.equal(pdf.getNumberOfPages(), 1)
  })

  it('keeps the page the right way round on a short page', () => {
    const pdf = buildPlayPdf(jsPDF, samples.spin2win)
    assert.ok(pdf.internal.pageSize.getHeight() < pdf.internal.pageSize.getWidth())
  })
})

describe('tickets in the PDF', () => {
  const lsItems = { k_spades: 100, a_hearts: 300, q_clubs: 20, j_diamonds: 300 }
  const ticket = (n: number, win: number, is_drawn = true, items: Record<string, unknown> = lsItems) => ({
    ticket_code: `LS-P17-${String(n).padStart(4, '0')}`, ticket_no: n, round_number: 1, total_stake: 720, is_drawn, win, items,
  })
  const lsContents = (t: { items: Record<string, unknown> }) => ticketTokens('LS', t.items, String)
  const tcContents = (t: { items: Record<string, unknown> }) => ticketTokens('TC', t.items, String)
  const save = (name: string, pdf: jsPDF) => {
    const folder = process.env.BSG_SAMPLE_PDFS
    if (folder) writeFileSync(`${folder}/${name}.pdf`, Buffer.from(pdf.output('arraybuffer')))
  }

  it('fits a few tickets on the page, which grows to hold them', () => {
    const data = { ...samples.lucky16, ticketContents: lsContents, tickets: [ticket(8, 2800), ticket(9, 0), ticket(10, 0, false)] }
    const pdf = buildPlayPdf(jsPDF, data)
    save('sample_lucky16_tickets', pdf)
    assert.equal(pdf.getNumberOfPages(), 1)
    assert.ok(pdf.internal.pageSize.getHeight() > playPdfPageHeight(16, 4))
  })

  it('runs hundreds of tickets on over more pages, none lost or cut', () => {
    const tickets = Array.from({ length: 300 }, (_, i) => ticket(i + 1, i % 7 === 0 ? 2800 : 0))
    const data = { ...samples.lucky16, ticketContents: lsContents, tickets }
    const pdf = buildPlayPdf(jsPDF, data)
    save('sample_lucky16_300_tickets', pdf)
    const plan = planPdfTickets(tickets, 100, lsContents)
    assert.equal(plan.pages.flatMap(p => p.rows).length, 300)
    assert.ok(pdf.getNumberOfPages() > 3)
    for (const page of plan.pages) {
      for (const { row, y } of page.rows) assert.ok(y + row.height <= page.height, 'a ticket stays on its page')
    }
  })

  it('starts on a new page when the page above is already long', () => {
    const plan = planPdfTickets([ticket(1, 0)], 1120, lsContents)
    assert.equal(plan.pages.length, 2)
    assert.equal(plan.pages[0].rows.length, 0)
    assert.equal(plan.firstPageHeight, 1120 + 32)
  })

  it('leaves a normal player unchanged', () => {
    const plan = planPdfTickets([], 500, lsContents)
    assert.equal(plan.firstPageHeight, 532)
    const page = (t?: []) => buildPlayPdf(jsPDF, { ...samples.lucky16, tickets: t })
    assert.equal(page([]).internal.pageSize.getHeight(), page(undefined).internal.pageSize.getHeight())
    assert.equal(page([]).getNumberOfPages(), 1)
  })

  it('fits the fullest Triple Chance ticket: every line inside the row', () => {
    const board = (n: number, pad: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i).padStart(pad, '0'), (i % 5 + 1) * 10]))
    const items = { single: board(10, 1), double: board(100, 2), triple: board(1000, 3) }
    const tickets = [ticket(1, 900, true, items), ticket(2, 0, false, { single: { 5: 2 } })]
      .map((t, i) => ({ ...t, ticket_code: `TC-P17-000${i + 1}` }))
    const data = { ...samples.lucky16, gameName: 'Triple Chance tickets only', roundLabel: 'TC-17413209', cells: [], ticketContents: tcContents, tickets }
    const pdf = buildPlayPdf(jsPDF, data)
    save('sample_triple_chance_tickets', pdf)
    pdf.setFont('courier', 'normal')
    pdf.setFontSize(11)
    const plan = planPdfTickets(tickets, 100, tcContents)
    const lines = plan.pages.flatMap(p => p.rows).flatMap(r => r.row.boards)
    assert.ok(lines.length > 10)
    for (const line of lines) assert.ok(pdf.getTextWidth(line) <= 700, line)
  })

  it('wraps a board on spaces and keeps every word', () => {
    const text = Array.from({ length: 200 }, (_, i) => String(i).padStart(3, '0')).join(', ')
    const lines = wrapBoardText('TRIPLE', text)
    assert.ok(lines.length > 1)
    assert.equal(lines.join(' '), `TRIPLE ${text}`)
  })
})

describe('sizes and name', () => {
  it('counts rows from the columns', () => {
    assert.equal(playPdfGridHeight(10, 5), 74 * 2 + 8)
    assert.equal(playPdfGridHeight(12, 4), 74 * 3 + 8 * 2)
    assert.equal(playPdfGridHeight(16, 4), 74 * 4 + 8 * 3)
  })

  it('names the file by round and player', () => {
    assert.equal(playPdfFileName(samples.lucky_card), 'LC-17413194-sample01.pdf')
  })
})
