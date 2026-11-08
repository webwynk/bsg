import type { jsPDF as JsPDF } from 'jspdf'
import type { StatementModel, Tone, Cell } from './agent-commission'

/**
 * Agent P&L statement PDF (2026-11-08; plan docs/AGENT_COMMISSION_PLAN.md).
 * Its own file on purpose: the game-play PDF (play-pdf.ts) is not touched.
 *
 * It only DRAWS: every figure and text comes ready-made from
 * buildStatementModel() in agent-commission.ts, where the rules are tested.
 *
 * A4 portrait, jsPDF's built-in Helvetica (no font download). Those fonts only
 * know the Windows-1252 characters, so text goes through pdfText(): "→" and
 * the minus/en dashes become ASCII.
 *
 * Layout: identity + period, the summary (Bets, Wins, P&L, commission, Final),
 * a per-game table and a per-day table (continues on new pages with its
 * header repeated), and a footer with the notes and "Page x of y" on every page.
 */

export interface AgentStatementData {
  agent: { fullName: string; username: string; accountCode: string | null }
  /** e.g. "Last 7 days: 2 Nov 2026 – 8 Nov 2026" (periodText). */
  period: string
  /** e.g. "8 Nov 2026, 12:41 PM IST". */
  generatedAt: string
  /** e.g. "superadmin @admin". */
  generatedBy: string
  model: StatementModel
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const M = 40
const W = PAGE_W - 2 * M
const FOOTER_H = 46
const ROW_H = 20

const COLORS: Record<Tone, string> = { ink: '#0f172a', muted: '#64748b', amber: '#b45309', pos: '#047857', neg: '#b91c1c' }
const LINE = '#e2e8f0', SOFT = '#f8fafc', ACCENT = '#4f46e5'

/** Only Windows-1252 characters survive the built-in fonts. */
export function pdfText(s: string): string {
  return s.replace(/→/g, '->').replace(/[−–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}

type Col = { title: string; w: number; align: 'left' | 'right' }

/** Cuts text with "..." so it fits maxWidth at the pdf's current font and size. */
function fitText(pdf: JsPDF, text: string, maxWidth: number): string {
  if (pdf.getTextWidth(text) <= maxWidth) return text
  let s = text
  while (s.length > 1 && pdf.getTextWidth(s + '...') > maxWidth) s = s.slice(0, -1)
  return s + '...'
}

const GAME_COLS: Col[] = [
  { title: 'Game', w: 125, align: 'left' }, { title: 'Plays', w: 60, align: 'right' }, { title: 'Bets (In)', w: 85, align: 'right' },
  { title: 'Wins (Out)', w: 85, align: 'right' }, { title: 'P&L', w: 80, align: 'right' }, { title: 'Commission', w: W - 435, align: 'right' },
]
const DAY_COLS: Col[] = [
  { title: 'Date (IST)', w: 105, align: 'left' }, { title: 'Plays', w: 50, align: 'right' }, { title: 'Bets (In)', w: 85, align: 'right' },
  { title: 'Wins (Out)', w: 85, align: 'right' }, { title: 'P&L', w: 80, align: 'right' }, { title: '%', w: 50, align: 'right' }, { title: 'Commission', w: W - 455, align: 'right' },
]

/** Builds the statement. `JsPDFCtor` is jsPDF's class (loaded lazily by the caller). */
export function buildAgentStatementPdf(JsPDFCtor: typeof JsPDF, data: AgentStatementData): JsPDF {
  const pdf = new JsPDFCtor({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const t = pdfText
  const font = (style: 'normal' | 'bold', size: number, tone: Tone = 'ink') => { pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(COLORS[tone]) }

  // Header
  pdf.setFillColor(ACCENT)
  pdf.rect(0, 0, PAGE_W, 6, 'F')
  let y = M
  font('bold', 18)
  pdf.text('Agent P&L Statement', M, y + 8)
  font('normal', 9, 'muted')
  pdf.text(t(`Generated ${data.generatedAt} by ${data.generatedBy}`), M + W, y + 8, { align: 'right' })
  y += 24

  // Identity + period
  pdf.setFillColor(SOFT); pdf.setDrawColor(LINE)
  pdf.roundedRect(M, y, W, 62, 6, 6, 'FD')
  // Agent ID on the right first, so a long name / username is cut to the space left of it.
  font('bold', 10, 'muted')
  const idText = t(`Agent ID: ${data.agent.accountCode ?? '-'}`)
  pdf.text(idText, M + W - 14, y + 24, { align: 'right' })
  const room = W - 28 - pdf.getTextWidth(idText) - 16
  font('normal', 11, 'muted')
  const user = fitText(pdf, t(`@${data.agent.username}`), room * 0.4)
  const userW = pdf.getTextWidth(user)
  font('bold', 14)
  const name = fitText(pdf, t(data.agent.fullName), room - userW - 8)
  pdf.text(name, M + 14, y + 24)
  const nameW = pdf.getTextWidth(name)
  font('normal', 11, 'muted')
  pdf.text(user, M + 14 + nameW + 8, y + 24)
  font('normal', 10, 'muted')
  pdf.text('Period (India time):', M + 14, y + 46)
  const labelW = pdf.getTextWidth('Period (India time):')
  font('bold', 11)
  pdf.text(t(data.period), M + 14 + labelW + 14, y + 46)
  y += 78

  // Summary
  font('bold', 11)
  pdf.text('Summary', M, y)
  y += 8
  for (const line of data.model.lines) {
    const h = line.strong ? 34 : 28
    if (line.strong) { pdf.setFillColor('#eef2ff'); pdf.setDrawColor('#c7d2fe') } else { pdf.setFillColor('#ffffff'); pdf.setDrawColor(LINE) }
    pdf.roundedRect(M, y, W, h, 4, 4, 'FD')
    font('bold', line.strong ? 12 : 10.5)
    pdf.text(t(line.label), M + 12, y + h / 2 + 4)
    font('normal', 8.5, 'muted')
    pdf.text(t(line.hint), M + 150, y + h / 2 + 3)
    font('bold', line.strong ? 14 : 11, line.tone)
    pdf.text(t(line.value), M + W - 12, y + h / 2 + 4, { align: 'right' })
    y += h + 5
  }
  if (data.model.rateNote) {
    font('normal', 8.5, 'amber')
    pdf.text(t(data.model.rateNote), M, y + 6, { maxWidth: W })
    y += 16
  }
  y += 10

  // Tables
  const drawHeader = (cols: Col[]) => {
    pdf.setFillColor('#f1f5f9'); pdf.rect(M, y, W, ROW_H, 'F')
    font('bold', 8.5, 'muted')
    let x = M
    for (const c of cols) { pdf.text(c.title, c.align === 'right' ? x + c.w - 8 : x + 8, y + 13.5, { align: c.align }); x += c.w }
    y += ROW_H
  }
  const drawRow = (cols: Col[], cells: Cell[], shade: boolean) => {
    if (shade) { pdf.setFillColor('#fbfdff'); pdf.rect(M, y, W, ROW_H, 'F') }
    pdf.setDrawColor(LINE); pdf.line(M, y + ROW_H, M + W, y + ROW_H)
    let x = M
    cells.forEach((cell, i) => {
      const c = cols[i]
      font(i === 0 ? 'bold' : 'normal', 9, cell.tone)
      pdf.text(t(cell.text), c.align === 'right' ? x + c.w - 8 : x + 8, y + 13.5, { align: c.align })
      x += c.w
    })
    y += ROW_H
  }
  const table = (title: string, cols: Col[], rows: Cell[][], empty: string) => {
    if (y + 40 + ROW_H * 2 > PAGE_H - FOOTER_H) { pdf.addPage('a4', 'portrait'); y = M }
    font('bold', 11); pdf.text(title, M, y); y += 8
    drawHeader(cols)
    if (rows.length === 0) { font('normal', 9, 'muted'); pdf.text(empty, M + 8, y + 14); y += ROW_H + 6; return }
    rows.forEach((cells, i) => {
      if (y + ROW_H > PAGE_H - FOOTER_H) {
        pdf.addPage('a4', 'portrait'); y = M
        font('bold', 9, 'muted'); pdf.text(`${title} (continued)`, M, y); y += 8
        drawHeader(cols)
      }
      drawRow(cols, cells, i % 2 === 1)
    })
    y += 16
  }
  table('By game', GAME_COLS, data.model.games, 'No plays.')
  table('By day', DAY_COLS, data.model.days, 'No plays in this period.')

  // Footer on every page
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setDrawColor(LINE); pdf.line(M, PAGE_H - FOOTER_H + 8, M + W, PAGE_H - FOOTER_H + 8)
    font('normal', 7.5, 'muted')
    pdf.text('All figures in coins. India time (IST). All 4 games, phone and Print bets included.', M, PAGE_H - FOOTER_H + 22)
    pdf.text("Commission = bets x the agent's % on each day. It is a report figure: no coins were moved.", M, PAGE_H - FOOTER_H + 32)
    pdf.text(`Page ${i} of ${pages}`, M + W, PAGE_H - FOOTER_H + 22, { align: 'right' })
  }
  return pdf
}
