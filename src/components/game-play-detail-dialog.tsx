"use client"

import * as React from 'react'
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
 * Offers "Download PDF": a screenshot of the printable content below,
 * captured with html2canvas-pro and embedded into a jsPDF document.
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
  const printableRef = React.useRef<HTMLDivElement>(null)

  const singleEntries = Object.entries(spin.single_bets || {})
  const doubleEntries = Object.entries(spin.double_bets || {})
  const tripleEntries = Object.entries(spin.triple_bets || {})

  const targetDouble = (spin.green !== null && spin.black !== null)
    ? `${spin.green}${spin.black}`.padStart(2, '0')
    : null
  const targetTriple = (spin.red !== null && spin.green !== null && spin.black !== null)
    ? `${spin.red}${spin.green}${spin.black}`.padStart(3, '0')
    : null

  // Extract individual outcome digits reliably (preferring numeric values, with fallback regex match)
  const redDigit = spin.red !== null && spin.red !== undefined ? String(spin.red) : null
  const greenDigit = spin.green !== null && spin.green !== undefined ? String(spin.green) : null
  const blackDigit = spin.black !== null && spin.black !== undefined ? String(spin.black) : null
  const fallbackDigits = spin.result ? String(spin.result).match(/\d/g) : null

  const d1 = redDigit ?? fallbackDigits?.[0] ?? '-'
  const d2 = greenDigit ?? fallbackDigits?.[1] ?? '-'
  const d3 = blackDigit ?? fallbackDigits?.[2] ?? '-'

  async function handleDownloadPdf() {
    if (!printableRef.current || isDownloading) return
    setIsDownloading(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ])
      const canvas = await html2canvas(printableRef.current, {
        scale: 2,
      })
      const imgData = canvas.toDataURL('image/png')

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height)

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
        className="w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] max-w-[95vw] lg:max-w-[1200px] max-h-[92vh] overflow-y-auto rounded-2xl p-0 border border-slate-200 shadow-2xl"
        style={{ background: '#ffffff', color: '#1e293b' }}
      >
        {/* Modern Top Gradient Accent */}
        <div
          className="h-1.5 w-full rounded-t-2xl"
          style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899, #f59e0b)' }}
        />

        {/* Modal Header */}
        <div className="px-4 sm:px-6 pt-4 pb-2 border-b border-slate-100 flex items-center justify-between">
          <DialogHeader>
            <DialogTitle
              className="text-base sm:text-lg font-black tracking-tight flex items-center gap-2"
              style={{ color: '#0f172a' }}
            >
              <span>Game Play Details</span>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div ref={printableRef} className="px-4 sm:px-6 py-4 space-y-4" style={{ background: '#ffffff' }}>

          {/* Top Bar: Player Info & Hand ID */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Player Identity Card */}
            <div
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-slate-200/90 bg-slate-50/70"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 shadow-xs"
                style={{ background: '#eef2ff', color: '#6366f1', border: '1.5px solid #c7d2fe' }}
              >
                {playerFullName[0]?.toUpperCase() || 'P'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-extrabold text-slate-900 truncate">{playerFullName}</p>
                <p className="text-[11px] font-mono text-slate-500 truncate">@{playerUsername}</p>
              </div>
            </div>

            {/* Hand ID Card */}
            <div
              className="flex flex-col justify-center px-3.5 py-2 rounded-xl border border-slate-200/90 bg-slate-50/70"
            >
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">
                Hand ID
              </span>
              <p className="text-xs font-mono font-bold text-slate-800 break-all select-all leading-tight mt-0.5">
                {spin.hand_id}
              </p>
            </div>
          </div>

          {/* Info Badges Row */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold shadow-2xs"
              style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0' }}
            >
              Triple Chance
            </span>
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-black tracking-wide"
              style={{ background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe' }}
            >
              {spin.mode}
            </span>
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-200/80"
            >
              {spin.created_at}
            </span>
          </div>

          {/* 4-Tile Metrics Grid: Result (0-8-9) · Total Bet · Total Win · Status */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* 1. Result (Boxed 0-8-9) */}
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 shadow-2xs">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
                Result
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-600 text-white font-mono font-black text-xs sm:text-sm flex items-center justify-center shadow-xs">
                  {d1}
                </span>
                <span className="text-slate-400 font-black text-xs sm:text-sm">-</span>
                <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-600 text-white font-mono font-black text-xs sm:text-sm flex items-center justify-center shadow-xs">
                  {d2}
                </span>
                <span className="text-slate-400 font-black text-xs sm:text-sm">-</span>
                <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-600 text-white font-mono font-black text-xs sm:text-sm flex items-center justify-center shadow-xs">
                  {d3}
                </span>
              </div>
            </div>

            {/* 2. Total Bet */}
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 shadow-2xs">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
                Total Bet
              </span>
              <span className="text-sm sm:text-base font-black font-mono text-slate-900">
                {formatCurrency(spin.total_stake)}
              </span>
            </div>

            {/* 3. Total Win */}
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 shadow-2xs">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
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
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 shadow-2xs">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
                Status
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] sm:text-xs font-black tracking-wide ${
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

          {/* Picks Breakdown Sections: Single, Double, Triple */}
          <div className="space-y-4 pt-1">
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
          className="flex items-center justify-between px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/80 rounded-b-2xl"
        >
          <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">
            Game play receipt & details
          </span>
          <Button
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            className="gap-2 text-xs font-bold h-9 px-4 rounded-xl cursor-pointer ml-auto shadow-xs hover:opacity-95 transition-opacity"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#ffffff',
              border: 'none',
            }}
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
 * and wrapping responsive cards (number on top with bold font, bold coin pill below). */
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
      {/* Section title with left accent bar and bet count */}
      <div className="flex items-center gap-2 mb-2.5">
        <div
          className="w-1 h-3.5 rounded-full"
          style={{ background: 'linear-gradient(180deg, #6366f1, #a855f7)' }}
        />
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
          {title}
        </h3>
        {entries.length > 0 && (
          <span className="text-[10px] font-extrabold font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
            {entries.length} {entries.length === 1 ? 'bet' : 'bets'}
          </span>
        )}
      </div>

      {entries.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {entries.map(([num, val]) => {
            const winning = isWinning(num)
            const display = num.padStart(pad, '0')
            return (
              <div
                key={num}
                className="flex flex-col rounded-xl overflow-hidden transition-all"
                style={{
                  minWidth: pad === 1 ? '52px' : pad === 2 ? '60px' : '68px',
                  boxShadow: winning
                    ? '0 0 10px rgba(16,185,129,0.35), 0 2px 4px rgba(0,0,0,0.06)'
                    : '0 1px 3px rgba(0,0,0,0.05)',
                  border: winning ? '1.5px solid #10b981' : '1px solid #e2e8f0',
                }}
              >
                {/* Number Box on Top */}
                <div
                  className="flex items-center justify-center px-2 py-1.5 font-black font-mono tracking-tight"
                  style={{
                    fontSize: pad === 3 ? '14px' : '17px',
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
                  className="flex items-center justify-center px-2 py-1 font-black font-mono tracking-tight"
                  style={{
                    fontSize: '11.5px',
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
        <p className="text-xs text-slate-400 italic pl-3">{emptyText}</p>
      )}
    </div>
  )
}
