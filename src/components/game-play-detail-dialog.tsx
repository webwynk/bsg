"use client"

import * as React from 'react'
import type { jsPDF as JsPDF } from 'jspdf'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Download, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

/** Fixed page-layout constants for the PDF receipt (all in px, matching the
 * jsPDF document's own `unit: 'px'`). Nothing here reads from the DOM or the
 * real device -- every value is drawn at these exact coordinates every time,
 * so there is no rendering step left that a browser/screen size can affect.
 * See MASTER_AUDIT_AND_REMEDIATION_PLAN.md Issue #95 for why the previous
 * screenshot-based approach (html2canvas) was replaced with this. */
const PDF_PAGE_WIDTH = 800
const PDF_MARGIN = 40
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2
// 1:1 square box -- columns per row derived from the fixed page width, not
// hardcoded, so changing PDF_PAGE_WIDTH or PDF_BOX_SIZE later automatically
// recomputes how many fit per row instead of needing a manual update.
// Sized for a denser grid within the fixed 800px page (15 cols/row) --
// the on-screen popup itself can show more columns on a wide desktop
// browser (its dialog stretches past 1000px there), which a fixed-width
// PDF page can't match without shrinking numbers past legibility.
const PDF_BOX_SIZE = 44
const PDF_BOX_GAP = 4
const PDF_COLUMNS = Math.max(1, Math.floor((PDF_CONTENT_WIDTH + PDF_BOX_GAP) / (PDF_BOX_SIZE + PDF_BOX_GAP)))
const PDF_BOX_NUMBER_H = Math.round(PDF_BOX_SIZE * 0.6)
const PDF_BOX_STAKE_H = PDF_BOX_SIZE - PDF_BOX_NUMBER_H
const PDF_ACCENT_BAR_H = 6
const PDF_TOP_MARGIN = 24
const PDF_IDENTITY_H = 76
const PDF_BLOCK_GAP = 16
const PDF_KPI_H = 68
const PDF_SECTION_HEADER_H = 26
const PDF_ROW_GAP = 8
const PDF_SECTION_GAP = 28
const PDF_BOTTOM_MARGIN = 32
const PDF_EMPTY_SECTION_H = 20

interface PdfPickSection {
  title: string
  entries: Array<[string, number]>
  pad: number
  isWinning: (num: string) => boolean
  emptyText: string
}

/** Height a single picks section (SINGLE/DOUBLE/TRIPLE) will take up, given
 * how many bets it has. The exact same function drives both the total-page-
 * height calculation and the actual drawing pass below, so the two can never
 * disagree with each other. */
function pdfSectionBodyHeight(entryCount: number): number {
  if (entryCount === 0) return PDF_EMPTY_SECTION_H
  const rows = Math.ceil(entryCount / PDF_COLUMNS)
  return rows * PDF_BOX_SIZE + (rows - 1) * PDF_ROW_GAP
}

function pdfTotalHeight(sections: PdfPickSection[]): number {
  let h = PDF_ACCENT_BAR_H + PDF_TOP_MARGIN + PDF_IDENTITY_H + PDF_BLOCK_GAP + PDF_KPI_H + PDF_BLOCK_GAP
  for (const section of sections) {
    h += PDF_SECTION_HEADER_H + pdfSectionBodyHeight(section.entries.length) + PDF_SECTION_GAP
  }
  return h + PDF_BOTTOM_MARGIN
}

function pdfBox(pdf: JsPDF, x: number, y: number, w: number, h: number, fill: string) {
  pdf.setFillColor(fill)
  pdf.rect(x, y, w, h, 'F')
}

/** One number box in a picks grid -- genuinely rounded corners with a
 * two-tone fill (number on top, stake pill on bottom), not just a sharp
 * rect. jsPDF has no "round only these corners" fill primitive, so this
 * clips subsequent fills to a rounded-rect path (confirmed working via an
 * isolated visual test before relying on it here) rather than drawing two
 * separately-rounded shapes that would overlap incorrectly. */
function pdfPickBox(pdf: JsPDF, x: number, y: number, display: string, stakeLabel: string, winning: boolean) {
  const numFill = winning ? '#d1fae5' : '#f8fafc'
  const stakeFill = winning ? '#10b981' : '#ef4444'
  const numText = winning ? '#047857' : '#0f172a'
  const border = winning ? '#10b981' : '#e2e8f0'

  pdf.saveGraphicsState()
  pdf.roundedRect(x, y, PDF_BOX_SIZE, PDF_BOX_SIZE, 8, 8, null)
  pdf.clip()
  pdf.setFillColor(numFill)
  pdf.rect(x, y, PDF_BOX_SIZE, PDF_BOX_NUMBER_H, 'F')
  pdf.setFillColor(stakeFill)
  pdf.rect(x, y + PDF_BOX_NUMBER_H, PDF_BOX_SIZE, PDF_BOX_STAKE_H, 'F')
  pdf.restoreGraphicsState()

  pdf.setDrawColor(border)
  pdf.roundedRect(x, y, PDF_BOX_SIZE, PDF_BOX_SIZE, 8, 8, 'D')

  pdf.setFont('courier', 'bold')
  pdf.setFontSize(14)
  pdf.setTextColor(numText)
  pdf.text(display, x + PDF_BOX_SIZE / 2, y + PDF_BOX_NUMBER_H / 2 + 5, { align: 'center' })

  pdf.setFont('courier', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor('#ffffff')
  pdf.text(stakeLabel, x + PDF_BOX_SIZE / 2, y + PDF_BOX_NUMBER_H + PDF_BOX_STAKE_H / 2 + 3, { align: 'center' })
}

function pdfBadge(
  pdf: JsPDF,
  x: number,
  y: number,
  label: string,
  fill: string,
  border: string,
  textColor: string,
  h = 18,
  fontSize = 9
): number {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(fontSize)
  const textWidth = pdf.getTextWidth(label)
  const w = textWidth + 16
  pdf.setFillColor(fill)
  pdf.setDrawColor(border)
  pdf.roundedRect(x, y, w, h, 4, 4, 'FD')
  pdf.setTextColor(textColor)
  pdf.text(label, x + w / 2, y + h / 2 + 3.5, { align: 'center' })
  return w
}

/** Matches PlayerGamePlay (agent/players/actions.ts) -- kept as a narrower,
 * local shape so this component doesn't import a page-owned type and can be
 * shared by both the agent and superadmin mirrors of the players page
 * without either one depending on the other's action module. */
export interface GamePlaySpin {
  hand_id: string
  mode: string
  result: string
  total_stake: number
  total_payout: number
  outcome: 'WON' | 'LOST'
  created_at: string
  single_bets: Record<string, number>
  double_bets: Record<string, number>
  triple_bets: Record<string, number>
  red: number | null
  green: number | null
  black: number | null
}

/**
 * Full-detail popup for one game play (hand) -- player identity, the same
 * 8-field summary already shown in the table row, and the Single/Double/
 * Triple picks breakdown with the winning pick highlighted.
 *
 * Offers "Download PDF": drawn directly with jsPDF (text/rects, no DOM
 * screenshot) at a fixed width, with height computed from how many bets
 * each section has -- identical output on every device, since nothing here
 * depends on the real browser's rendering. See MASTER_AUDIT_AND_REMEDIATION_PLAN.md
 * Issue #95 for why an earlier html2canvas-based version was replaced.
 */
export function GamePlayDetailDialog({
  spin,
  playerFullName,
  playerUsername,
  trigger,
}: {
  spin: GamePlaySpin
  playerFullName: string
  playerUsername: string
  trigger: React.ReactElement
}) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [isDownloading, setIsDownloading] = React.useState(false)

  const singleEntries = Object.entries(spin.single_bets || {}).sort(
    ([a], [b]) => Number(a) - Number(b) || a.localeCompare(b)
  )
  const doubleEntries = Object.entries(spin.double_bets || {}).sort(
    ([a], [b]) => Number(a) - Number(b) || a.localeCompare(b)
  )
  const tripleEntries = Object.entries(spin.triple_bets || {}).sort(
    ([a], [b]) => Number(a) - Number(b) || a.localeCompare(b)
  )

  const targetDouble = (spin.green !== null && spin.black !== null)
    ? `${spin.green}${spin.black}`.padStart(2, '0')
    : null
  const targetTriple = (spin.red !== null && spin.green !== null && spin.black !== null)
    ? `${spin.red}${spin.green}${spin.black}`.padStart(3, '0')
    : null

  // Extract individual outcome digits reliably
  const redDigit = spin.red !== null && spin.red !== undefined ? String(spin.red) : null
  const greenDigit = spin.green !== null && spin.green !== undefined ? String(spin.green) : null
  const blackDigit = spin.black !== null && spin.black !== undefined ? String(spin.black) : null
  const fallbackDigits = spin.result ? String(spin.result).match(/\d/g) : null

  const d1 = redDigit ?? fallbackDigits?.[0] ?? '-'
  const d2 = greenDigit ?? fallbackDigits?.[1] ?? '-'
  const d3 = blackDigit ?? fallbackDigits?.[2] ?? '-'

  async function handleDownloadPdf() {
    if (isDownloading) return
    setIsDownloading(true)
    try {
      const { default: jsPDF } = await import('jspdf')

      const sections: PdfPickSection[] = [
        { title: 'SINGLE', entries: singleEntries, pad: 1, isWinning: (num) => spin.black !== null && num === spin.black.toString(), emptyText: 'No Single bets placed.' },
        { title: 'DOUBLE', entries: doubleEntries, pad: 2, isWinning: (num) => targetDouble !== null && num.padStart(2, '0') === targetDouble, emptyText: 'No Double bets placed.' },
        { title: 'TRIPLE', entries: tripleEntries, pad: 3, isWinning: (num) => targetTriple !== null && num.padStart(3, '0') === targetTriple, emptyText: 'No Triple bets placed.' },
      ]

      const pageHeight = pdfTotalHeight(sections)
      // jsPDF silently SWAPS a custom [width, height] format's two values
      // whenever they don't match the requested orientation -- confirmed
      // directly (a hardcoded 'portrait' with a short hand's page, where
      // height ends up less than PDF_PAGE_WIDTH, was flipped into a page
      // that's actually only as wide as the intended height, cutting off
      // anything positioned using the real PDF_PAGE_WIDTH, like the Total
      // Win/Status columns). Passing the orientation that actually matches
      // this page's real shape avoids the swap entirely.
      const orientation = pageHeight >= PDF_PAGE_WIDTH ? 'portrait' : 'landscape'
      const pdf = new jsPDF({ orientation, unit: 'px', format: [PDF_PAGE_WIDTH, pageHeight] })

      // Background + top accent bar
      pdfBox(pdf, 0, 0, PDF_PAGE_WIDTH, pageHeight, '#ffffff')
      pdfBox(pdf, 0, 0, PDF_PAGE_WIDTH, PDF_ACCENT_BAR_H, '#6366f1')

      let y = PDF_ACCENT_BAR_H + PDF_TOP_MARGIN

      // --- Identity block (compact 2-row layout matching the live popup) ---
      pdf.setFillColor('#f8fafc')
      pdf.setDrawColor('#e2e8f0')
      pdf.roundedRect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, PDF_IDENTITY_H, 8, 8, 'FD')

      // Row 1: Left side (Avatar + Name + Username)
      const avatarR = 14
      const avatarCx = PDF_MARGIN + 14 + avatarR
      const avatarCy = y + 12 + avatarR
      pdf.setFillColor('#eef2ff')
      pdf.setDrawColor('#c7d2fe')
      pdf.circle(avatarCx, avatarCy, avatarR, 'FD')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(15) // +3px from 12
      pdf.setTextColor('#6366f1')
      pdf.text((playerFullName[0] || 'P').toUpperCase(), avatarCx, avatarCy + 5, { align: 'center' })

      const nameX = avatarCx + avatarR + 10
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(18) // +3px from 15
      pdf.setTextColor('#0f172a')
      pdf.text(playerFullName, nameX, y + 31)
      const nameW = pdf.getTextWidth(playerFullName)

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(14) // +3px from 11
      pdf.setTextColor('#94a3b8')
      pdf.text(`@${playerUsername}`, nameX + nameW + 8, y + 31)

      // Row 1: Right side (Badges: Game, Mode, Created At)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(12) // +3px from 9
      const badge1W = pdf.getTextWidth('Triple Chance') + 16
      const badge2W = pdf.getTextWidth(spin.mode) + 16
      const badge3W = pdf.getTextWidth(spin.created_at) + 16
      const badgeGap = 6
      const totalBadgesW = badge1W + badge2W + badge3W + badgeGap * 2
      const rightEdge = PDF_MARGIN + PDF_CONTENT_WIDTH - 14
      let badgeX = rightEdge - totalBadgesW
      const badgeY = y + 15

      pdfBadge(pdf, badgeX, badgeY, 'Triple Chance', '#ffffff', '#e2e8f0', '#475569', 22, 12)
      badgeX += badge1W + badgeGap
      pdfBadge(pdf, badgeX, badgeY, spin.mode, '#eef2ff', '#c7d2fe', '#4f46e5', 22, 12)
      badgeX += badge2W + badgeGap
      pdfBadge(pdf, badgeX, badgeY, spin.created_at, '#ffffff', '#e2e8f0', '#64748b', 22, 12)

      // Divider line
      pdf.setDrawColor('#e2e8f0')
      pdf.line(PDF_MARGIN + 14, y + 46, PDF_MARGIN + PDF_CONTENT_WIDTH - 14, y + 46)

      // Row 2: Hand ID
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11) // +3px from 8
      pdf.setTextColor('#94a3b8')
      pdf.text('HAND ID:', PDF_MARGIN + 14, y + 62)
      pdf.setFont('courier', 'bold')
      pdf.setFontSize(13) // +3px from 10
      pdf.setTextColor('#334155')
      pdf.text(spin.hand_id, PDF_MARGIN + 14 + pdf.getTextWidth('HAND ID:') + 8, y + 62)

      y += PDF_IDENTITY_H + PDF_BLOCK_GAP

      // --- KPI band: Result / Total Bet / Total Win / Status (compact 68px card) ---
      pdf.setFillColor('#f8fafc')
      pdf.setDrawColor('#e2e8f0')
      pdf.roundedRect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, PDF_KPI_H, 8, 8, 'FD')
      const colW = PDF_CONTENT_WIDTH / 4
      for (let i = 1; i < 4; i++) {
        pdf.setDrawColor('#e2e8f0')
        pdf.line(PDF_MARGIN + colW * i, y + 8, PDF_MARGIN + colW * i, y + PDF_KPI_H - 8)
      }

      const kpiLabel = (text: string, colIndex: number) => {
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(11)
        pdf.setTextColor('#64748b')
        pdf.text(text, PDF_MARGIN + colW * colIndex + colW / 2, y + 18, { align: 'center' })
      }

      // Col 0: Result digits with '-' hyphens (matching popup)
      kpiLabel('RESULT', 0)
      const digits: Array<[string, string]> = [[d1, '#dc2626'], [d2, '#059669'], [d3, '#0f172a']]
      const digitBoxSize = 26
      const hyphenW = 12
      const digitsTotalW = digitBoxSize * 3 + hyphenW * 2
      let digitX = PDF_MARGIN + colW * 0 + colW / 2 - digitsTotalW / 2
      digits.forEach(([digit, color], index) => {
        pdf.setFillColor(color)
        pdf.roundedRect(digitX, y + 28, digitBoxSize, digitBoxSize, 4, 4, 'F')
        pdf.setFont('courier', 'bold')
        pdf.setFontSize(16) // enlarged from 15
        pdf.setTextColor('#ffffff')
        pdf.text(digit, digitX + digitBoxSize / 2, y + 28 + digitBoxSize / 2 + 5.5, { align: 'center' })
        digitX += digitBoxSize

        if (index < 2) {
          pdf.setFont('courier', 'bold')
          pdf.setFontSize(16)
          pdf.setTextColor('#94a3b8')
          pdf.text('-', digitX + hyphenW / 2, y + 28 + digitBoxSize / 2 + 5.5, { align: 'center' })
          digitX += hyphenW
        }
      })

      // Col 1: Total Bet (enlarged 20pt bold Courier)
      kpiLabel('TOTAL BET', 1)
      pdf.setFont('courier', 'bold')
      pdf.setFontSize(20) // enlarged from 17
      pdf.setTextColor('#0f172a')
      pdf.text(formatCurrency(spin.total_stake), PDF_MARGIN + colW * 1 + colW / 2, y + 49, { align: 'center' })

      // Col 2: Total Win (enlarged 20pt bold Courier)
      kpiLabel('TOTAL WIN', 2)
      pdf.setFont('courier', 'bold')
      pdf.setFontSize(20) // enlarged from 17
      pdf.setTextColor(spin.total_payout > 0 ? '#059669' : '#94a3b8')
      pdf.text(spin.total_payout > 0 ? `+${formatCurrency(spin.total_payout)}` : '-', PDF_MARGIN + colW * 2 + colW / 2, y + 49, { align: 'center' })

      // Col 3: Status pill with status dot (matching popup, enlarged 14pt)
      kpiLabel('STATUS', 3)
      const won = spin.outcome === 'WON'
      const statusLabel = spin.outcome
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(14) // enlarged from 13
      const statusTextW = pdf.getTextWidth(statusLabel)
      const dotR = 3
      const statusW = statusTextW + 36
      const statusH = 24
      const statusX = PDF_MARGIN + colW * 3 + colW / 2 - statusW / 2
      const statusY = y + 29
      pdf.setFillColor(won ? '#ecfdf5' : '#fef2f2')
      pdf.setDrawColor(won ? '#6ee7b7' : '#fca5a5')
      pdf.roundedRect(statusX, statusY, statusW, statusH, 12, 12, 'FD')

      const dotCx = statusX + 12
      const dotCy = statusY + statusH / 2
      pdf.setFillColor(won ? '#10b981' : '#ef4444')
      pdf.circle(dotCx, dotCy, dotR, 'F')

      pdf.setTextColor(won ? '#047857' : '#b91c1c')
      pdf.text(statusLabel, statusX + 12 + dotR + 6 + statusTextW / 2, statusY + statusH / 2 + 5, { align: 'center' })

      y += PDF_KPI_H + PDF_BLOCK_GAP

      // --- Picks sections ---
      for (const section of sections) {
        pdf.setFillColor('#6366f1')
        pdf.rect(PDF_MARGIN, y + 4, 3, 14, 'F')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(12)
        pdf.setTextColor('#1e293b')
        pdf.text(section.title, PDF_MARGIN + 10, y + 15)
        const titleW = pdf.getTextWidth(section.title)
        const countLabel = `${section.entries.length} ${section.entries.length === 1 ? 'bet' : 'bets'}`
        pdfBadge(pdf, PDF_MARGIN + 10 + titleW + 10, y + 3, countLabel, '#eef2ff', '#c7d2fe', '#4338ca')

        y += PDF_SECTION_HEADER_H

        if (section.entries.length === 0) {
          pdf.setFont('helvetica', 'italic')
          pdf.setFontSize(10)
          pdf.setTextColor('#94a3b8')
          pdf.text(section.emptyText, PDF_MARGIN + 4, y + 12)
        } else {
          section.entries.forEach(([num, val], i) => {
            const col = i % PDF_COLUMNS
            const row = Math.floor(i / PDF_COLUMNS)
            const boxX = PDF_MARGIN + col * (PDF_BOX_SIZE + PDF_BOX_GAP)
            const boxY = y + row * (PDF_BOX_SIZE + PDF_ROW_GAP)
            const winning = section.isWinning(num)
            const display = num.padStart(section.pad, '0')

            pdfPickBox(pdf, boxX, boxY, display, formatCurrency(val), winning)
          })
        }

        y += pdfSectionBodyHeight(section.entries.length) + PDF_SECTION_GAP
      }

      const safeHandId = spin.hand_id.replace(/[^a-zA-Z0-9]/g, '')
      pdf.save(`hand-${safeHandId}-${playerUsername}.pdf`)
    } catch (e) {
      console.error('PDF generation failed:', e)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent
        className="w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] max-w-[95vw] lg:max-w-[1100px] max-h-[92vh] overflow-y-auto rounded-2xl p-0 border border-slate-200 shadow-2xl"
        style={{ background: '#ffffff', color: '#1e293b' }}
      >
        {/* Modern Top Gradient Accent Bar */}
        <div
          className="h-1 w-full rounded-t-2xl"
          style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899, #f59e0b)' }}
        />

        {/* Modal Header */}
        <div className="px-4 sm:px-5 pt-3 pb-2 border-b border-slate-100 flex items-center justify-between">
          <DialogHeader>
            <DialogTitle
              className="text-sm sm:text-base font-black tracking-tight flex items-center gap-2"
              style={{ color: '#0f172a' }}
            >
              <span>Game Play Details</span>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div
          className="px-4 sm:px-5 py-3 space-y-3"
          style={{ background: '#ffffff' }}
        >

          {/* 1. Consolidated Identity Ribbon (Player + Mode + Date + Hand ID) */}
          <div className="p-2.5 sm:p-3 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-2">
            {/* Top Row: Avatar + Name + Tags + Timestamp */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 shadow-2xs"
                  style={{ background: '#eef2ff', color: '#6366f1', border: '1.5px solid #c7d2fe' }}
                >
                  {playerFullName[0]?.toUpperCase() || 'P'}
                </div>
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-xs sm:text-sm font-black text-slate-900 truncate">{playerFullName}</span>
                  <span className="text-[11px] font-mono text-slate-400 truncate">@{playerUsername}</span>
                </div>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold"
                  style={{ background: '#ffffff', color: '#475569', border: '1px solid #e2e8f0' }}
                >
                  Triple Chance
                </span>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black tracking-wide"
                  style={{ background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe' }}
                >
                  {spin.mode}
                </span>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono text-slate-500 bg-white border border-slate-200"
                >
                  {spin.created_at}
                </span>
              </div>
            </div>

            {/* Bottom Row: Full Hand ID */}
            <div className="flex items-center gap-2 pt-1.5 border-t border-slate-200/70 text-[11px] font-mono">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 shrink-0">Hand ID:</span>
              <span className="font-bold text-slate-700 truncate select-all">{spin.hand_id}</span>
            </div>
          </div>

          {/* 2. Unified 4-in-1 KPI Ribbon (Result · Bet · Win · Status) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 rounded-xl bg-slate-50/90 border border-slate-200/80 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/80 overflow-hidden shadow-2xs">
            {/* 1. Result (Boxed Red - Green - Black) */}
            <div className="flex flex-col items-center justify-center py-2.5 px-3">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Result
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5">
                {/* 1st Digit: Red Wheel */}
                <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-red-600 text-white font-mono font-black text-xs sm:text-sm flex items-center justify-center shadow-2xs">
                  {d1}
                </span>
                <span className="text-slate-400 font-black text-xs sm:text-sm">-</span>
                {/* 2nd Digit: Green Wheel */}
                <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-600 text-white font-mono font-black text-xs sm:text-sm flex items-center justify-center shadow-2xs">
                  {d2}
                </span>
                <span className="text-slate-400 font-black text-xs sm:text-sm">-</span>
                {/* 3rd Digit: Black Wheel */}
                <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-900 text-white font-mono font-black text-xs sm:text-sm flex items-center justify-center shadow-2xs">
                  {d3}
                </span>
              </div>
            </div>

            {/* 2. Total Bet */}
            <div className="flex flex-col items-center justify-center py-2.5 px-3">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Total Bet
              </span>
              <span className="text-sm sm:text-base font-black font-mono text-slate-900">
                {formatCurrency(spin.total_stake)}
              </span>
            </div>

            {/* 3. Total Win */}
            <div className="flex flex-col items-center justify-center py-2.5 px-3 border-t lg:border-t-0">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Total Win
              </span>
              <span
                className={`text-sm sm:text-base font-black font-mono ${
                  spin.total_payout > 0 ? 'text-emerald-600' : 'text-slate-400'
                }`}
              >
                {spin.total_payout > 0 ? `+${formatCurrency(spin.total_payout)}` : '-'}
              </span>
            </div>

            {/* 4. Status */}
            <div className="flex flex-col items-center justify-center py-2.5 px-3 border-t lg:border-t-0">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Status
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] sm:text-xs font-black tracking-wide ${
                  spin.outcome === 'WON'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-2xs'
                    : 'bg-red-50 text-red-700 border border-red-300'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    spin.outcome === 'WON' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                  }`}
                />
                {spin.outcome}
              </span>
            </div>
          </div>

          {/* 3. Picks Breakdown Sections (Single, Double, Triple) */}
          <div className="space-y-7 pt-3">
            <PicksSection
              title="SINGLE"
              entries={singleEntries}
              pad={1}
              isWinning={(num) => spin.black !== null && num === spin.black.toString()}
              emptyText="No Single bets placed."
            />
            <PicksSection
              title="DOUBLE"
              entries={doubleEntries}
              pad={2}
              isWinning={(num) => targetDouble !== null && num.padStart(2, '0') === targetDouble}
              emptyText="No Double bets placed."
            />
            <PicksSection
              title="TRIPLE"
              entries={tripleEntries}
              pad={3}
              isWinning={(num) => targetTriple !== null && num.padStart(3, '0') === targetTriple}
              emptyText="No Triple bets placed."
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div
          className="flex items-center justify-between px-4 sm:px-5 py-2.5 border-t border-slate-200 bg-slate-50/80 rounded-b-2xl"
        >
          <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">
            Game play receipt & details
          </span>
          <Button
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            className="gap-2 text-xs font-bold h-8 px-3.5 rounded-lg cursor-pointer ml-auto shadow-xs hover:opacity-95 transition-opacity"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#ffffff',
              border: 'none',
            }}
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Generating PDF…</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                <span>Download PDF</span>
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** One Single/Double/Triple picks section -- with category header, count tag,
 * and auto-fill responsive grid eliminating right-side white gap (equal sizing across all tiers). */
function PicksSection({
  title,
  entries,
  pad,
  isWinning,
  emptyText,
}: {
  title: string
  entries: Array<[string, number]>
  pad: number
  isWinning: (num: string) => boolean
  emptyText: string
}) {
  return (
    <div>
      {/* Section title with left accent bar and highlighted bet count */}
      <div className="flex items-center gap-2.5 mb-3.5">
        <div
          className="w-1.5 h-4 sm:h-4.5 rounded-full"
          style={{ background: 'linear-gradient(180deg, #6366f1, #a855f7)' }}
        />
        <h3 className="text-sm sm:text-base font-black uppercase tracking-wider text-slate-800">
          {title}
        </h3>
        {entries.length > 0 ? (
          <span className="text-[11px] sm:text-xs font-black font-mono px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/90 shadow-2xs">
            {entries.length} {entries.length === 1 ? 'bet' : 'bets'}
          </span>
        ) : (
          <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200">
            0 bets
          </span>
        )}
      </div>

      {entries.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-1.5">
          {entries.map(([num, val]) => {
            const winning = isWinning(num)
            const display = num.padStart(pad, '0')
            return (
              <div
                key={num}
                className="flex flex-col rounded-lg overflow-hidden transition-all shadow-2xs"
                style={{
                  boxShadow: winning
                    ? '0 0 10px rgba(16,185,129,0.35), 0 2px 4px rgba(0,0,0,0.06)'
                    : '0 1px 2px rgba(0,0,0,0.04)',
                  border: winning ? '1.5px solid #10b981' : '1px solid #e2e8f0',
                }}
              >
                {/* Number Box on Top */}
                <div
                  className="flex items-center justify-center py-1 text-[14px] sm:text-[15px] font-black font-mono tracking-tight"
                  style={{
                    background: winning
                      ? 'linear-gradient(180deg, #ecfdf5, #d1fae5)'
                      : '#f8fafc',
                    color: winning ? '#047857' : '#0f172a',
                  }}
                >
                  {display}
                </div>

                {/* Coin Stake Pill on Bottom */}
                <div
                  className="flex items-center justify-center py-0.5 text-[11.5px] sm:text-[12px] font-black font-mono tracking-tight"
                  style={{
                    background: winning ? '#10b981' : '#ef4444',
                    color: '#ffffff',
                  }}
                >
                  {formatCurrency(val)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 italic pl-3">{emptyText}</p>
      )}
    </div>
  )
}
