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
    if (!printableRef.current || isDownloading) return
    setIsDownloading(true)
    let detachedClone: HTMLDivElement | null = null
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ])

      // DialogContent sets overflow-y-auto (so tall content scrolls on small
      // screens) but never sets overflow-x. Per the CSS spec, a browser can't
      // leave one axis 'visible' while the other scrolls, so it silently
      // coerces overflow-x to 'auto' too -- clipping anything wider than the
      // popup's own on-screen box. That's exactly what was happening to the
      // desktop-forced 1050px layout below once html2canvas captured it in
      // place, cutting off the right edge of the downloaded PDF. Fix: clone
      // the printable content onto <body> directly, outside that clipping
      // ancestor, and capture the clone instead -- the visible popup itself
      // is never resized or altered.
      // Positioned at (0,0) -- normal, in-viewport coordinates, not pushed
      // off-screen -- and hidden purely by stacking order (a very negative
      // z-index, underneath the page's own opaque content). An earlier
      // version of this fix used `left: -99999px` to move it off-screen
      // instead; that produced a canvas far larger than intended, since it
      // made html2canvas measure a capture region spanning the full
      // ~100,000px distance back to the visible page.
      detachedClone = printableRef.current.cloneNode(true) as HTMLDivElement
      detachedClone.style.position = 'fixed'
      detachedClone.style.top = '0'
      detachedClone.style.left = '0'
      detachedClone.style.margin = '0'
      detachedClone.style.zIndex = '-2147483648'
      detachedClone.style.pointerEvents = 'none'
      // Own, guaranteed-unique marker -- cloneNode(true) copies data-printable
      // from the live element too, so while the dialog is open there are TWO
      // elements carrying that attribute at once (the original, still-visible
      // content, and this hidden copy). onclone below used to query by
      // data-printable and grab whichever matched first -- confirmed live via
      // instrumentation that it was silently grabbing the ORIGINAL (still
      // on-screen) element, not this one, so the 1050px width was never
      // actually applied to what's being captured. This marker exists only on
      // the detached clone, never on the live content, so the query below can
      // never be ambiguous regardless of how many dialogs/copies coexist.
      detachedClone.setAttribute('data-pdf-capture-target', 'true')
      document.body.appendChild(detachedClone)

      // Render fixed 1050px desktop layout on ALL devices (mobile, tablet, desktop).
      // windowWidth is still needed here even though the clone above already
      // escaped the clipping ancestor -- it makes html2canvas's own virtual
      // render window wide enough for this content's sm:/lg: Tailwind
      // breakpoints to evaluate as desktop, regardless of the real device's
      // actual screen width.
      const canvas = await html2canvas(detachedClone, {
        scale: 2,
        windowWidth: 1200,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc) => {
          const el = clonedDoc.querySelector('[data-pdf-capture-target="true"]') as HTMLElement
          if (el) {
            el.style.width = '1050px'
            el.style.minWidth = '1050px'
            el.style.maxWidth = '1050px'
          }
        },
      })

      // High-quality JPEG compression (drops file size from ~6MB to ~300KB-400KB)
      const imgData = canvas.toDataURL('image/jpeg', 0.95)

      // Set logical desktop page dimensions (1050px width)
      const pdfWidth = 1050
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [pdfWidth, pdfHeight] })
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight)

      const safeHandId = spin.hand_id.replace(/[^a-zA-Z0-9]/g, '')
      pdf.save(`hand-${safeHandId}-${playerUsername}.pdf`)
    } catch (e) {
      console.error('PDF generation failed:', e)
    } finally {
      if (detachedClone) document.body.removeChild(detachedClone)
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
          ref={printableRef}
          data-printable="true"
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
