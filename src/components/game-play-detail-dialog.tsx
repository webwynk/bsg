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

  const details: Array<{ label: string; value: string }> = [
    { label: 'Hand ID', value: spin.hand_id },
    { label: 'Game', value: 'Triple Chance' },
    { label: 'Mode', value: spin.mode },
    { label: 'Date & Time', value: spin.created_at },
    { label: 'Win Result', value: spin.result.toString().padStart(3, '0') },
    { label: 'Bet', value: `${formatCurrency(spin.total_stake)} Coins` },
    { label: 'Win', value: spin.total_payout > 0 ? `+${formatCurrency(spin.total_payout)} Coins` : '0 Coins' },
    { label: 'Status', value: spin.outcome },
  ]

  async function handleDownloadPdf() {
    if (!printableRef.current || isDownloading) return
    setIsDownloading(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ])
      // No backgroundColor override: the ref'd wrapper already carries a
      // real bg-card background (correct for whichever theme -- light or
      // dark -- is active), so html2canvas captures the true theme color
      // instead of a hardcoded guess that would be wrong for one of them.
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

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[1240px] w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto bg-card border-border text-foreground rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-black text-lg">Game Play Details</DialogTitle>
        </DialogHeader>

        <div ref={printableRef} className="space-y-4 bg-card p-1">
          {/* Player identity */}
          <div className="flex items-center space-x-3 p-3 rounded-xl bg-secondary/40 border border-border/60">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-sm shrink-0">
              {playerFullName[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-foreground truncate">{playerFullName}</p>
              <p className="text-[11px] text-muted-foreground font-mono truncate">@{playerUsername}</p>
            </div>
          </div>

          {/* Full details grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {details.map((d) => (
              <div key={d.label} className="p-2.5 rounded-xl bg-secondary/20 border border-border/50">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{d.label}</p>
                <p className={`text-xs font-black font-mono mt-0.5 truncate ${
                  d.label === 'Status'
                    ? (spin.outcome === 'WON' ? 'text-success-text' : 'text-danger-text')
                    : 'text-foreground'
                }`}>
                  {d.value}
                </p>
              </div>
            ))}
          </div>

          {/* Picks breakdown -- Single, Double, Triple */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Single Digit Picks (Black) */}
            <div className="p-3 rounded-xl bg-card border border-border/70 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-black text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-zinc-950 border border-zinc-600 shrink-0" />
                  Single Picks (Black)
                </h4>
                <span className="text-[10px] font-mono font-bold text-muted-foreground bg-secondary/60 px-1.5 py-0.2 rounded">
                  {singleEntries.length} {singleEntries.length === 1 ? 'pick' : 'picks'}
                </span>
              </div>
              {singleEntries.length > 0 ? (
                <div className="space-y-1 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                  {singleEntries.map(([num, val]) => {
                    const isWinning = spin.black !== null && num === spin.black.toString()
                    return (
                      <div key={num} className={`w-full flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                        isWinning ? 'bg-zinc-950 text-white border border-zinc-700 font-extrabold shadow-sm' : 'bg-secondary/30 text-foreground border border-border/40'
                      }`}>
                        <span>Digit: <strong className="font-black text-primary">{num}</strong></span>
                        <span className="font-mono font-bold">{formatCurrency(val)} Coins</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic py-1">No Single bets placed.</p>
              )}
            </div>

            {/* Double Digit Picks (Green) */}
            <div className="p-3 rounded-xl bg-card border border-border/70 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-black text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  Double Picks (Green)
                </h4>
                <span className="text-[10px] font-mono font-bold text-muted-foreground bg-secondary/60 px-1.5 py-0.2 rounded">
                  {doubleEntries.length} {doubleEntries.length === 1 ? 'pick' : 'picks'}
                </span>
              </div>
              {doubleEntries.length > 0 ? (
                <div className="space-y-1 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                  {doubleEntries.map(([num, val]) => {
                    const isWinning = targetDouble !== null && num.padStart(2, '0') === targetDouble
                    return (
                      <div key={num} className={`w-full flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                        isWinning ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-extrabold shadow-sm' : 'bg-secondary/30 text-foreground border border-border/40'
                      }`}>
                        <span>Picks: <strong className="font-black text-primary">{num.padStart(2, '0')}</strong></span>
                        <span className="font-mono font-bold">{formatCurrency(val)} Coins</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic py-1">No Double bets placed.</p>
              )}
            </div>

            {/* Triple Digit Picks (Red) */}
            <div className="p-3 rounded-xl bg-card border border-border/70 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-black text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  Triple Picks (Red)
                </h4>
                <span className="text-[10px] font-mono font-bold text-muted-foreground bg-secondary/60 px-1.5 py-0.2 rounded">
                  {tripleEntries.length} {tripleEntries.length === 1 ? 'pick' : 'picks'}
                </span>
              </div>
              {tripleEntries.length > 0 ? (
                <div className="space-y-1 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                  {tripleEntries.map(([num, val]) => {
                    const isWinning = targetTriple !== null && num.padStart(3, '0') === targetTriple
                    return (
                      <div key={num} className={`w-full flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                        isWinning ? 'bg-red-500/20 text-red-400 border border-red-500/40 font-extrabold shadow-sm' : 'bg-secondary/30 text-foreground border border-border/40'
                      }`}>
                        <span>Picks: <strong className="font-black text-primary">{num.padStart(3, '0')}</strong></span>
                        <span className="font-mono font-bold">{formatCurrency(val)} Coins</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic py-1">No Triple bets placed.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            className="gap-1.5"
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                Download PDF
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
