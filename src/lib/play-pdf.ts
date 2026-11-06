import type { jsPDF as JsPDF } from 'jspdf'
import type { PlayerTicket, TicketToken } from './player-tickets'

/**
 * The per-round PDF of Lucky Card, Lucky 16 and Spin2Win, in the style of the
 * Triple Chance PDF (components/game-play-detail-dialog.tsx, which keeps its own
 * code). Drawn with text and shapes at fixed sizes, so a phone and a PC give the
 * same file. The built-in PDF fonts have no suit symbols, so those are drawn as
 * shapes, and every height is worked out before drawing, by the same functions.
 */

const PAGE_WIDTH = 800
const MARGIN = 40
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const ACCENT_H = 6
const TOP_GAP = 24
const IDENTITY_H = 76
const BLOCK_GAP = 16
const WIN_BAR_H = 96
const HEADER_H = 26
const CELL_H = 74
const CELL_FACE_H = 50
const CELL_GAP = 8
const BOTTOM_GAP = 32
const TICKET_GAP = 6
const TICKET_TOP_H = 28
const TICKET_PAD = 10
const TOKEN_W = 84
const TOKEN_H = 18
const TOKEN_COLUMNS = Math.floor((CONTENT_WIDTH - TICKET_PAD * 2) / TOKEN_W)
const BOARD_LINE_H = 15
const BOARD_FONT = 11
/** Courier is 0.6em wide. The test measures the fullest ticket against this. */
const BOARD_LINE_CHARS = Math.floor((CONTENT_WIDTH - TICKET_PAD * 2) / (BOARD_FONT * 0.6))
/** Ticket pages stop here, so hundreds of tickets run on across pages. */
const TICKET_PAGE_H = 1130
const CONTINUED_TOP = ACCENT_H + TOP_GAP + HEADER_H

export type PdfSuit = 'hearts' | 'spades' | 'diamonds' | 'clubs'

/** What a grid cell, or the win bar, shows: a card or a coloured number. */
export type PdfFace =
  | { kind: 'card'; rank: string; suit: PdfSuit }
  | { kind: 'number'; number: number; color: string }

export interface PlayPdfCell {
  face: PdfFace
  amount: number
  isWinner: boolean
}

export interface PlayPdfData {
  /** Goes on the header badge, such as "Lucky Card". */
  gameName: string
  /** Shown as it stands, such as "LC-17413194". */
  roundLabel: string
  createdAt: string
  playerFullName: string
  playerUsername: string
  /** "WINNING CARD" or "WINNING NUMBER". */
  resultTitle: string
  /** Null until the round is drawn. */
  result: PdfFace | null
  bonusLabel: string
  totalStake: number
  totalPayout: number
  outcome: 'WON' | 'LOST' | 'PENDING'
  /** "COINS ON EACH CARD" or "COINS ON EACH NUMBER". */
  gridTitle: string
  gridColumns: number
  cells: PlayPdfCell[]
  /** A Print player's tickets in this round. Empty or missing: no ticket section. */
  tickets?: PlayerTicket[]
  /** A ticket's contents, from ticketTokens for the game. */
  ticketContents?: (ticket: PlayerTicket) => TicketToken[]
  formatAmount: (amount: number) => string
}

/** The file's name, as Triple Chance builds its own. */
export function playPdfFileName(data: Pick<PlayPdfData, 'roundLabel' | 'playerUsername'>): string {
  return `${data.roundLabel}-${data.playerUsername}.pdf`
}

export function playPdfGridHeight(cellCount: number, columns: number): number {
  const rows = Math.ceil(cellCount / columns)
  return rows * CELL_H + (rows - 1) * CELL_GAP
}

export function playPdfPageHeight(cellCount: number, columns: number): number {
  return playPdfContentEnd(cellCount, columns) + BOTTOM_GAP
}

function playPdfContentEnd(cellCount: number, columns: number): number {
  return ACCENT_H + TOP_GAP + IDENTITY_H + BLOCK_GAP + WIN_BAR_H + BLOCK_GAP
    + HEADER_H + playPdfGridHeight(cellCount, columns)
}

/** Splits a Triple Chance board onto lines of Courier that fit a ticket row. */
export function wrapBoardText(title: string, text: string): string[] {
  const lines: string[] = []
  let line = `${title} `
  for (const word of text.split(' ')) {
    if (line.length + word.length + 1 > BOARD_LINE_CHARS) {
      lines.push(line.trimEnd())
      line = ''
    }
    line += `${word} `
  }
  lines.push(line.trimEnd())
  return lines
}

interface TicketRow {
  ticket: PlayerTicket
  tokens: TicketToken[]
  boards: string[]
  height: number
}

/** Where every ticket goes: which page, and how far down it. */
export interface PdfTicketPlan {
  /** The first page's height, holding what is above plus the tickets that fit. */
  firstPageHeight: number
  /** Where the first page's tickets start, under their title. */
  contentEnd: number
  pages: Array<{ height: number; rows: Array<{ row: TicketRow; y: number }> }>
}

/**
 * Lays out tickets from contentEnd, the foot of what is above them. The first
 * page grows up to TICKET_PAGE_H; the rest run on over pages of that height. A
 * ticket is never split, and one taller than a page gets a page its own height.
 */
export function planPdfTickets(
  tickets: PlayerTicket[],
  contentEnd: number,
  contents: (ticket: PlayerTicket) => TicketToken[],
): PdfTicketPlan {
  const rows = tickets.map(ticket => {
    const tokens = contents(ticket)
    const pieces = tokens.filter(t => t.kind !== 'board')
    const boards = tokens.flatMap(t => (t.kind === 'board' ? wrapBoardText(t.title, t.text) : []))
    const height = TICKET_TOP_H + Math.ceil(pieces.length / TOKEN_COLUMNS) * TOKEN_H + boards.length * BOARD_LINE_H + TICKET_PAD
    return { ticket, tokens: pieces, boards, height }
  })

  const pages: PdfTicketPlan['pages'] = [{ height: 0, rows: [] }]
  let y = contentEnd + BLOCK_GAP + HEADER_H
  for (const row of rows) {
    const page = pages[pages.length - 1]
    if (y + row.height + BOTTOM_GAP > TICKET_PAGE_H && (page.rows.length > 0 || pages.length === 1)) {
      pages.push({ height: 0, rows: [] })
      y = CONTINUED_TOP
    }
    pages[pages.length - 1].rows.push({ row, y })
    y += row.height + TICKET_GAP
    pages[pages.length - 1].height = y - TICKET_GAP + BOTTOM_GAP
  }
  pages.slice(1).forEach((page, i) => {
    // Every page but the last keeps the full height, so a printout stays even.
    if (i < pages.length - 2) page.height = Math.max(page.height, TICKET_PAGE_H)
  })
  pages[0].height = pages[0].height || contentEnd + BOTTOM_GAP
  return { firstPageHeight: pages[0].height, contentEnd, pages }
}

/** Heart and spade share a shape, one upside down. Its points run around the outline. */
function drawHeart(pdf: JsPDF, cx: number, cy: number, size: number, flip: boolean) {
  const s = size / 2
  const d = flip ? -1 : 1
  const r = s * 0.53
  pdf.circle(cx - s * 0.47, cy - d * s * 0.3, r, 'F')
  pdf.circle(cx + s * 0.47, cy - d * s * 0.3, r, 'F')
  pdf.triangle(cx - s * 0.97, cy - d * s * 0.12, cx + s * 0.97, cy - d * s * 0.12, cx, cy + d * s, 'F')
}

function drawStem(pdf: JsPDF, cx: number, top: number, bottom: number, half: number) {
  pdf.triangle(cx, top, cx - half, bottom, cx + half, bottom, 'F')
}

/** One suit symbol, centred on (cx, cy), red or near-black as on the popups. */
export function drawSuit(pdf: JsPDF, suit: PdfSuit, cx: number, cy: number, size: number) {
  const s = size / 2
  pdf.setFillColor(suit === 'hearts' || suit === 'diamonds' ? '#dc2626' : '#0f172a')
  if (suit === 'hearts') {
    drawHeart(pdf, cx, cy, size, false)
  } else if (suit === 'diamonds') {
    pdf.triangle(cx, cy - s, cx - s * 0.74, cy, cx + s * 0.74, cy, 'F')
    pdf.triangle(cx, cy + s, cx - s * 0.74, cy, cx + s * 0.74, cy, 'F')
  } else if (suit === 'spades') {
    drawHeart(pdf, cx, cy - s * 0.12, size * 0.88, true)
    drawStem(pdf, cx, cy, cy + s, s * 0.34)
  } else {
    const r = s * 0.45
    pdf.circle(cx, cy - s * 0.48, r, 'F')
    pdf.circle(cx - s * 0.5, cy + s * 0.14, r, 'F')
    pdf.circle(cx + s * 0.5, cy + s * 0.14, r, 'F')
    drawStem(pdf, cx, cy - s * 0.1, cy + s, s * 0.32)
  }
}

/** A card (rank then drawn suit) or a number chip, centred on (cx, cy). */
function drawFace(pdf: JsPDF, face: PdfFace, cx: number, cy: number, size: number, dim = false) {
  if (face.kind === 'card') {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(size)
    pdf.setTextColor(face.suit === 'hearts' || face.suit === 'diamonds' ? '#dc2626' : '#0f172a')
    const rankW = pdf.getTextWidth(face.rank)
    const gap = size * 0.14
    const suitSize = size * 0.74
    const left = cx - (rankW + gap + suitSize) / 2
    pdf.text(face.rank, left, cy + size * 0.35)
    drawSuit(pdf, face.suit, left + rankW + gap + suitSize / 2, cy + size * 0.04, suitSize)
    return
  }
  const r = size * 0.72
  pdf.setFillColor(dim ? '#cbd5e1' : face.color)
  pdf.circle(cx, cy, r, 'F')
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(size)
  pdf.setTextColor('#ffffff')
  pdf.text(String(face.number), cx, cy + size * 0.34, { align: 'center' })
}

function badge(pdf: JsPDF, x: number, y: number, label: string, fill: string, border: string, text: string, h = 22, fontSize = 12): number {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(fontSize)
  const w = pdf.getTextWidth(label) + 16
  pdf.setFillColor(fill)
  pdf.setDrawColor(border)
  pdf.roundedRect(x, y, w, h, 4, 4, 'FD')
  pdf.setTextColor(text)
  pdf.text(label, x + w / 2, y + h / 2 + fontSize * 0.35, { align: 'center' })
  return w
}

function drawIdentity(pdf: JsPDF, data: PlayPdfData, y: number) {
  pdf.setFillColor('#f8fafc')
  pdf.setDrawColor('#e2e8f0')
  pdf.roundedRect(MARGIN, y, CONTENT_WIDTH, IDENTITY_H, 8, 8, 'FD')

  const r = 14
  const cx = MARGIN + 14 + r
  const cy = y + 12 + r
  pdf.setFillColor('#eef2ff')
  pdf.setDrawColor('#c7d2fe')
  pdf.circle(cx, cy, r, 'FD')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.setTextColor('#6366f1')
  pdf.text((data.playerFullName[0] || 'P').toUpperCase(), cx, cy + 5, { align: 'center' })

  const nameX = cx + r + 10
  pdf.setFontSize(18)
  pdf.setTextColor('#0f172a')
  pdf.text(data.playerFullName, nameX, y + 31)
  const nameW = pdf.getTextWidth(data.playerFullName)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(14)
  pdf.setTextColor('#94a3b8')
  pdf.text(`@${data.playerUsername}`, nameX + nameW + 8, y + 31)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  const gameW = pdf.getTextWidth(data.gameName) + 16
  const dateW = pdf.getTextWidth(data.createdAt) + 16
  const right = MARGIN + CONTENT_WIDTH - 14
  badge(pdf, right - gameW - dateW - 6, y + 15, data.gameName, '#ffffff', '#e2e8f0', '#475569')
  badge(pdf, right - dateW, y + 15, data.createdAt, '#ffffff', '#e2e8f0', '#64748b')

  pdf.setDrawColor('#e2e8f0')
  pdf.line(MARGIN + 14, y + 46, MARGIN + CONTENT_WIDTH - 14, y + 46)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#94a3b8')
  pdf.text('ROUND ID:', MARGIN + 14, y + 62)
  const labelW = pdf.getTextWidth('ROUND ID:')
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor('#334155')
  pdf.text(data.roundLabel, MARGIN + 14 + labelW + 8, y + 62)
}

const STATUS_STYLE = {
  WON: { fill: '#ecfdf5', border: '#6ee7b7', dot: '#10b981', text: '#047857' },
  LOST: { fill: '#fef2f2', border: '#fca5a5', dot: '#ef4444', text: '#b91c1c' },
  PENDING: { fill: '#fffbeb', border: '#fcd34d', dot: '#f59e0b', text: '#b45309' },
}

function drawWinBar(pdf: JsPDF, data: PlayPdfData, y: number) {
  pdf.setFillColor('#f8fafc')
  pdf.setDrawColor('#e2e8f0')
  pdf.roundedRect(MARGIN, y, CONTENT_WIDTH, WIN_BAR_H, 8, 8, 'FD')
  const colW = CONTENT_WIDTH / 4
  for (let i = 1; i < 4; i++) {
    pdf.setDrawColor('#e2e8f0')
    pdf.line(MARGIN + colW * i, y + 8, MARGIN + colW * i, y + WIN_BAR_H - 8)
  }
  const centre = (col: number) => MARGIN + colW * col + colW / 2
  const label = (text: string, col: number) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor('#64748b')
    pdf.text(text, centre(col), y + 18, { align: 'center' })
  }

  label(data.resultTitle, 0)
  if (data.result) {
    drawFace(pdf, data.result, centre(0), y + 42, data.result.kind === 'card' ? 24 : 16)
  } else {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12)
    pdf.setTextColor('#94a3b8')
    pdf.text('Not drawn yet', centre(0), y + 46, { align: 'center' })
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  const bonusW = pdf.getTextWidth(data.bonusLabel) + 16
  const plain = data.bonusLabel === 'N'
  badge(pdf, centre(0) - bonusW / 2, y + 68, data.bonusLabel,
    plain ? '#ffffff' : '#fffbeb', plain ? '#e2e8f0' : '#fde68a', plain ? '#64748b' : '#b45309', 16, 9)

  label('TOTAL BET', 1)
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(20)
  pdf.setTextColor('#0f172a')
  pdf.text(data.formatAmount(data.totalStake), centre(1), y + 54, { align: 'center' })

  label('TOTAL WIN', 2)
  const won = data.totalPayout > 0
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(20)
  pdf.setTextColor(won ? '#059669' : '#94a3b8')
  pdf.text(won ? `+${data.formatAmount(data.totalPayout)}` : '-', centre(2), y + 54, { align: 'center' })
  if (data.outcome !== 'PENDING') {
    const net = data.totalPayout - data.totalStake
    pdf.setFontSize(11)
    pdf.setTextColor(net >= 0 ? '#059669' : '#94a3b8')
    pdf.text(`net ${net >= 0 ? '+' : ''}${data.formatAmount(net)}`, centre(2), y + 72, { align: 'center' })
  }

  label('STATUS', 3)
  const style = STATUS_STYLE[data.outcome]
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  const textW = pdf.getTextWidth(data.outcome)
  const w = textW + 36
  const h = 24
  const x = centre(3) - w / 2
  const top = y + 38
  pdf.setFillColor(style.fill)
  pdf.setDrawColor(style.border)
  pdf.roundedRect(x, top, w, h, 12, 12, 'FD')
  pdf.setFillColor(style.dot)
  pdf.circle(x + 12, top + h / 2, 3, 'F')
  pdf.setTextColor(style.text)
  pdf.text(data.outcome, x + 21 + textW / 2, top + h / 2 + 5, { align: 'center' })
}

/** One cell, two-tone like a Triple Chance bet box: the face over its coins. */
function drawCell(pdf: JsPDF, data: PlayPdfData, cell: PlayPdfCell, x: number, y: number, w: number) {
  const bet = cell.amount > 0
  const faceFill = cell.isWinner ? '#d1fae5' : bet ? '#eef2ff' : '#ffffff'
  const stripFill = cell.isWinner ? '#10b981' : bet ? '#6366f1' : '#f1f5f9'
  const border = cell.isWinner ? '#10b981' : bet ? '#c7d2fe' : '#e2e8f0'

  pdf.saveGraphicsState()
  pdf.roundedRect(x, y, w, CELL_H, 8, 8, null)
  pdf.clip()
  pdf.discardPath()
  pdf.setFillColor(faceFill)
  pdf.rect(x, y, w, CELL_FACE_H, 'F')
  pdf.setFillColor(stripFill)
  pdf.rect(x, y + CELL_FACE_H, w, CELL_H - CELL_FACE_H, 'F')
  pdf.restoreGraphicsState()

  pdf.setDrawColor(border)
  pdf.setLineWidth(cell.isWinner ? 1.5 : 1)
  pdf.roundedRect(x, y, w, CELL_H, 8, 8, 'D')
  pdf.setLineWidth(1)

  drawFace(pdf, cell.face, x + w / 2, y + CELL_FACE_H / 2, cell.face.kind === 'card' ? 20 : 15, !bet && !cell.isWinner)

  const stripMid = y + CELL_FACE_H + (CELL_H - CELL_FACE_H) / 2
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(14)
  pdf.setTextColor(bet || cell.isWinner ? '#ffffff' : '#94a3b8')
  const text = bet ? data.formatAmount(cell.amount) : '-'
  if (cell.isWinner) {
    pdf.text(bet ? text : 'NO BET', x + 10, stripMid + 4.5)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.text('WINNER', x + w - 10, stripMid + 3.5, { align: 'right' })
  } else {
    pdf.text(text, x + w / 2, stripMid + 4.5, { align: 'center' })
  }
}

function drawGrid(pdf: JsPDF, data: PlayPdfData, y: number) {
  pdf.setFillColor('#6366f1')
  pdf.rect(MARGIN, y + 4, 3, 14, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor('#1e293b')
  pdf.text(data.gridTitle, MARGIN + 10, y + 15)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor('#94a3b8')
  pdf.text('the winner is shown in green', MARGIN + CONTENT_WIDTH, y + 15, { align: 'right' })

  const top = y + HEADER_H
  const w = (CONTENT_WIDTH - CELL_GAP * (data.gridColumns - 1)) / data.gridColumns
  data.cells.forEach((cell, i) => {
    const col = i % data.gridColumns
    const row = Math.floor(i / data.gridColumns)
    drawCell(pdf, data, cell, MARGIN + col * (w + CELL_GAP), top + row * (CELL_H + CELL_GAP), w)
  })
}

function drawTicketRow(pdf: JsPDF, row: TicketRow, y: number, format: (amount: number) => string) {
  const { ticket } = row
  const won = ticket.win > 0
  pdf.setFillColor(won ? '#ecfdf5' : '#ffffff')
  pdf.setDrawColor(won ? '#6ee7b7' : '#e2e8f0')
  pdf.setLineWidth(1)
  pdf.roundedRect(MARGIN, y, CONTENT_WIDTH, row.height, 6, 6, 'FD')

  const left = MARGIN + TICKET_PAD
  const right = MARGIN + CONTENT_WIDTH - TICKET_PAD
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor('#0f172a')
  pdf.text(ticket.ticket_code, left, y + 19)
  pdf.setFontSize(12)
  pdf.setTextColor(won ? '#059669' : '#94a3b8')
  const result = ticket.is_drawn ? (won ? `Win +${format(ticket.win)}` : 'Win -') : 'Waiting'
  pdf.text(result, right, y + 19, { align: 'right' })
  const resultW = pdf.getTextWidth(result)
  pdf.setTextColor('#64748b')
  pdf.text(`Bet ${format(ticket.total_stake)}`, right - resultW - 24, y + 19, { align: 'right' })

  const top = y + TICKET_TOP_H
  row.tokens.forEach((token, i) => {
    const x = left + (i % TOKEN_COLUMNS) * TOKEN_W
    const mid = top + Math.floor(i / TOKEN_COLUMNS) * TOKEN_H + TOKEN_H / 2
    if (token.kind === 'board') return
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor('#0f172a')
    let textX = x
    if (token.kind === 'card') {
      pdf.setTextColor(token.suit === 'hearts' || token.suit === 'diamonds' ? '#dc2626' : '#0f172a')
      pdf.text(token.rank, x, mid + 4)
      const rankW = pdf.getTextWidth(token.rank)
      drawSuit(pdf, token.suit, x + rankW + 7, mid, 10)
      textX = x + rankW + 15
    } else {
      pdf.text(String(token.number), x, mid + 4)
      textX = x + 12
    }
    pdf.setFont('courier', 'normal')
    pdf.setTextColor('#334155')
    pdf.text(format(token.amount), textX, mid + 4)
  })
  const boardTop = top + Math.ceil(row.tokens.length / TOKEN_COLUMNS) * TOKEN_H
  pdf.setFont('courier', 'normal')
  pdf.setFontSize(BOARD_FONT)
  pdf.setTextColor('#334155')
  row.boards.forEach((line, i) => pdf.text(line, left, boardTop + i * BOARD_LINE_H + 10))
}

/**
 * Draws the planned tickets on the current page and the pages after it: number,
 * bet, win and contents of each, winning tickets tinted. Triple Chance's PDF
 * calls this too, so all 4 games show tickets alike.
 */
export function drawPdfTickets(
  pdf: JsPDF,
  plan: PdfTicketPlan,
  total: number,
  label: string,
  format: (amount: number) => string,
) {
  plan.pages.forEach((page, i) => {
    if (i > 0) {
      pdf.addPage([PAGE_WIDTH, page.height], page.height >= PAGE_WIDTH ? 'portrait' : 'landscape')
      pdf.setFillColor('#ffffff')
      pdf.rect(0, 0, PAGE_WIDTH, page.height, 'F')
      pdf.setFillColor('#6366f1')
      pdf.rect(0, 0, PAGE_WIDTH, ACCENT_H, 'F')
    }
    const top = i === 0 ? plan.contentEnd + BLOCK_GAP : ACCENT_H + TOP_GAP
    if (page.rows.length > 0) {
      pdf.setFillColor('#6366f1')
      pdf.rect(MARGIN, top + 4, 3, 14, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(12)
      pdf.setTextColor('#1e293b')
      pdf.text('TICKETS', MARGIN + 10, top + 15)
      const titleW = pdf.getTextWidth('TICKETS')
      badge(pdf, MARGIN + 10 + titleW + 10, top + 3, `${total} ${total === 1 ? 'ticket' : 'tickets'}`, '#eef2ff', '#c7d2fe', '#4338ca', 18, 9)
      if (plan.pages.length > 1) {
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(10)
        pdf.setTextColor('#94a3b8')
        pdf.text(`${label}, page ${i + 1} of ${plan.pages.length}`, MARGIN + CONTENT_WIDTH, top + 15, { align: 'right' })
      }
    }
    page.rows.forEach(({ row, y }) => drawTicketRow(pdf, row, y, format))
  })
}

/** Draws the whole page and returns the document, ready to save. */
export function buildPlayPdf(PdfClass: typeof JsPDF, data: PlayPdfData): JsPDF {
  const tickets = data.tickets ?? []
  const plan = planPdfTickets(tickets, playPdfContentEnd(data.cells.length, data.gridColumns), data.ticketContents ?? (() => []))
  const height = plan.firstPageHeight
  // jsPDF swaps a custom page's two sizes if they disagree with the orientation.
  const pdf = new PdfClass({
    orientation: height >= PAGE_WIDTH ? 'portrait' : 'landscape',
    unit: 'px',
    format: [PAGE_WIDTH, height],
  })
  pdf.setFillColor('#ffffff')
  pdf.rect(0, 0, PAGE_WIDTH, height, 'F')
  pdf.setFillColor('#6366f1')
  pdf.rect(0, 0, PAGE_WIDTH, ACCENT_H, 'F')

  let y = ACCENT_H + TOP_GAP
  drawIdentity(pdf, data, y)
  y += IDENTITY_H + BLOCK_GAP
  drawWinBar(pdf, data, y)
  y += WIN_BAR_H + BLOCK_GAP
  drawGrid(pdf, data, y)
  drawPdfTickets(pdf, plan, tickets.length, data.roundLabel, data.formatAmount)
  return pdf
}
