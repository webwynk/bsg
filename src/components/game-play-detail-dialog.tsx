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

  // Extract individual outcome digits reliably
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

        <div ref={printableRef} className="px-4 sm:px-5 py-3 space-y-3" style={{ background: '#ffffff' }}>

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
            {/* 1. Result (Boxed 0-8-9) */}
            <div className="flex flex-col items-center justify-center py-2 px-3">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                Result
              </span>
              <div className="flex items-center gap-1">
                <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-indigo-600 text-white font-mono font-black text-xs sm:text-sm flex items-center justify-center shadow-2xs">
                  {d1}
                </span>
                <span className="text-slate-400 font-bold text-xs">-</span>
                <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-indigo-600 text-white font-mono font-black text-xs sm:text-sm flex items-center justify-center shadow-2xs">
                  {d2}
                </span>
                <span className="text-slate-400 font-bold text-xs">-</span>
                <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-indigo-600 text-white font-mono font-black text-xs sm:text-sm flex items-center justify-center shadow-2xs">
                  {d3}
                </span>
              </div>
            </div>

            {/* 2. Total Bet */}
            <div className="flex flex-col items-center justify-center py-2 px-3">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                Total Bet
              </span>
              <span className="text-xs sm:text-sm font-black font-mono text-slate-900">
                {formatCurrency(spin.total_stake)}
              </span>
            </div>

            {/* 3. Total Win */}
            <div className="flex flex-col items-center justify-center py-2 px-3 border-t lg:border-t-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                Total Win
              </span>
              <span
                className={`text-xs sm:text-sm font-black font-mono ${
                  spin.total_payout > 0 ? 'text-emerald-600' : 'text-slate-400'
                }`}
              >
                {spin.total_payout > 0 ? `+${formatCurrency(spin.total_payout)}` : '-'}
              </span>
            </div>

            {/* 4. Status */}
            <div className="flex flex-col items-center justify-center py-2 px-3 border-t lg:border-t-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                Status
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide ${
                  spin.outcome === 'WON'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    spin.outcome === 'WON' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                  }`}
                />
                {spin.outcome}
              </span>
            </div>
          </div>

          {/* 3. Picks Breakdown Sections (Single, Double, Triple) */}
          <div className="space-y-3 pt-1">
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
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-1 h-3.5 rounded-full"
          style={{ background: 'linear-gradient(180deg, #6366f1, #a855f7)' }}
        />
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
          {title}
        </h3>
        {entries.length > 0 && (
          <span className="text-[10px] font-extrabold font-mono px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
            {entries.length} {entries.length === 1 ? 'bet' : 'bets'}
          </span>
        )}
      </div>

      {entries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([num, val]) => {
            const winning = isWinning(num)
            const display = num.padStart(pad, '0')
            return (
              <div
                key={num}
                className="flex flex-col rounded-xl overflow-hidden transition-all shadow-2xs"
                style={{
                  minWidth: pad === 1 ? '48px' : pad === 2 ? '56px' : '64px',
                  boxShadow: winning
                    ? '0 0 10px rgba(16,185,129,0.35), 0 2px 4px rgba(0,0,0,0.06)'
                    : '0 1px 3px rgba(0,0,0,0.04)',
                  border: winning ? '1.5px solid #10b981' : '1px solid #e2e8f0',
                }}
              >
                {/* Number Box on Top */}
                <div
                  className="flex items-center justify-center px-1.5 py-1 font-black font-mono tracking-tight"
                  style={{
                    fontSize: pad === 3 ? '13px' : '16px',
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
                  className="flex items-center justify-center px-1.5 py-0.5 font-black font-mono tracking-tight"
                  style={{
                    fontSize: '11px',
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
