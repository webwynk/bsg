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
 * Triple picks breakdown with the winning pick highlighted. Replaces the 4
 * near-duplicated inline-expand blocks (mobile card + desktop table, in
 * both agent/players/[[...slug]]/page.tsx and its superadmin mirror) that
 * existed before this component -- one shared implementation instead of
 * four copies that could silently drift apart.
 *
 * Also offers "Download PDF": a screenshot of the printable content below,
 * captured with html2canvas-pro (not plain html2canvas -- this project's
 * Tailwind v4 theme uses oklch() colors, which the original html2canvas
 * cannot parse) and embedded into a jsPDF document.
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

  async function handleDownloadPdf() {
    if (!printableRef.current || isDownloading) return
    setIsDownloading(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ])
      // No backgroundColor override: the ref'd wrapper already carries a
      // real bg-white background, so html2canvas captures the true color.
      const canvas = await html2canvas(printableRef.current, {
        scale: 2,
      })
      const imgData = canvas.toDataURL('image/png')

      // One page, sized exactly to the captured content -- this is a short
      // receipt-style summary, not a multi-page document, so there's no
      // overflow to paginate. A page dimensioned to the content avoids any
      // cropping/splitting entirely, at the cost of not matching a physical
      // paper size (fine for a "save and view digitally" download).
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

  const resultDigits = spin.result.toString().padStart(3, '0')

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent
        className="w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] sm:max-w-[640px] lg:max-w-[1200px] max-h-[90vh] overflow-y-auto rounded-2xl p-0 border-0 shadow-2xl"
        style={{ background: '#ffffff', color: '#1e293b' }}
      >
        {/* Gradient accent bar */}
        <div
          className="h-1 w-full rounded-t-2xl"
          style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7, #ec4899)' }}
        />

        <div className="px-5 pt-3 pb-1">
          <DialogHeader>
            <DialogTitle
              className="text-sm font-bold tracking-tight"
              style={{ color: '#0f172a' }}
            >
              Game Play Details
            </DialogTitle>
          </DialogHeader>
        </div>

        <div ref={printableRef} className="px-5 pb-4 space-y-3" style={{ background: '#ffffff' }}>

          {/* Player identity — compact inline row */}
          <div
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0"
              style={{ background: '#eef2ff', color: '#6366f1', border: '1px solid #c7d2fe' }}
            >
              {playerFullName[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold truncate" style={{ color: '#0f172a' }}>{playerFullName}</p>
              <p className="text-[10px] font-mono truncate" style={{ color: '#94a3b8' }}>@{playerUsername}</p>
            </div>
          </div>

          {/* Hand ID — full reveal, prominent */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: '#94a3b8' }}>
              Hand ID
            </p>
            <p
              className="text-[11px] font-mono font-bold break-all leading-snug"
              style={{ color: '#334155' }}
            >
              {spin.hand_id}
            </p>
          </div>

          {/* Info badges row: Game · Mode · Date */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold"
              style={{ background: '#f1f5f9', color: '#475569' }}
            >
              Triple Chance
            </span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold"
              style={{ background: '#eef2ff', color: '#6366f1' }}
            >
              {spin.mode}
            </span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono"
              style={{ background: '#f8fafc', color: '#64748b' }}
            >
              {spin.created_at}
            </span>
          </div>

          {/* Stats grid: Result · Bet · Win · Status */}
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg overflow-hidden"
            style={{ background: '#e2e8f0' }}
          >
            {/* Result */}
            <div className="flex flex-col items-center py-2 px-1" style={{ background: '#ffffff' }}>
              <span className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: '#94a3b8' }}>
                Result
              </span>
              <span className="flex items-center gap-0.5">
                {resultDigits.split('').map((d, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black font-mono"
                    style={{ background: '#6366f1', color: '#ffffff' }}
                  >
                    {d}
                  </span>
                ))}
              </span>
            </div>
            {/* Bet */}
            <div className="flex flex-col items-center py-2 px-1" style={{ background: '#ffffff' }}>
              <span className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: '#94a3b8' }}>
                Bet
              </span>
              <span className="text-xs font-black font-mono" style={{ color: '#0f172a' }}>
                {formatCurrency(spin.total_stake)}
              </span>
            </div>
            {/* Win */}
            <div className="flex flex-col items-center py-2 px-1" style={{ background: '#ffffff' }}>
              <span className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: '#94a3b8' }}>
                Win
              </span>
              <span
                className="text-xs font-black font-mono"
                style={{ color: spin.total_payout > 0 ? '#059669' : '#94a3b8' }}
              >
                {spin.total_payout > 0 ? `+${formatCurrency(spin.total_payout)}` : '-'}
              </span>
            </div>
            {/* Status */}
            <div className="flex flex-col items-center py-2 px-1" style={{ background: '#ffffff' }}>
              <span className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: '#94a3b8' }}>
                Status
              </span>
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black"
                style={spin.outcome === 'WON'
                  ? { background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }
                  : { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: spin.outcome === 'WON' ? '#10b981' : '#ef4444' }}
                />
                {spin.outcome}
              </span>
            </div>
          </div>

          {/* Picks breakdown -- Single, Double, Triple */}
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

        {/* Download button */}
        <div
          className="flex justify-end px-5 py-3 rounded-b-2xl"
          style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}
        >
          <Button
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            className="gap-1.5 text-xs h-8 px-3 rounded-lg cursor-pointer"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#ffffff',
              border: 'none',
            }}
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Download className="h-3 w-3" />
                Download PDF
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** One Single/Double/Triple picks section -- a compact accent-bar title
 * followed by a tight wrapping row of number "chips" (the digit on top, the
 * coin stake in a colored pill below it). Green chip = the winning pick;
 * red pill = every other one. */
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
      {/* Section title with left accent bar */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-0.5 h-3.5 rounded-full"
          style={{ background: 'linear-gradient(180deg, #6366f1, #a855f7)' }}
        />
        <h3
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color: '#64748b' }}
        >
          {title}
        </h3>
      </div>

      {entries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([num, val]) => {
            const winning = isWinning(num)
            const display = num.padStart(pad, '0')
            return (
              <div
                key={num}
                className="flex flex-col rounded-lg overflow-hidden"
                style={{
                  minWidth: pad === 1 ? '48px' : pad === 2 ? '56px' : '64px',
                  boxShadow: winning
                    ? '0 0 8px rgba(16,185,129,0.3), 0 1px 3px rgba(0,0,0,0.08)'
                    : '0 1px 3px rgba(0,0,0,0.06)',
                  border: winning ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
                }}
              >
                <div
                  className="flex items-center justify-center px-1.5 py-1 font-black font-mono"
                  style={{
                    fontSize: pad === 3 ? '14px' : '18px',
                    background: winning
                      ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)'
                      : '#f8fafc',
                    color: winning ? '#059669' : '#334155',
                  }}
                >
                  {display}
                </div>
                <div
                  className="flex items-center justify-center px-1.5 py-0.5 text-[10px] font-black font-mono"
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
        <p className="text-[10px] italic" style={{ color: '#94a3b8' }}>{emptyText}</p>
      )}
    </div>
  )
}
