"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

        <div ref={printableRef} className="space-y-5 bg-card p-1">
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

          {/* Compact single-row details table, matching the main Game Plays
              table's own header/row style */}
          <div className="overflow-x-auto rounded-xl border border-border/70 table-scroll">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                  <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Hand ID</TableHead>
                  <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Game</TableHead>
                  <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Mode</TableHead>
                  <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Date & Time</TableHead>
                  <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider">Win Result</TableHead>
                  <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider">Bet</TableHead>
                  <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider">Win</TableHead>
                  <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5">{spin.hand_id}</TableCell>
                  <TableCell className="text-[11px] font-semibold text-foreground p-2.5">Triple Chance</TableCell>
                  <TableCell className="text-[11px] font-bold text-primary p-2.5">{spin.mode}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground font-mono whitespace-nowrap p-2.5">{spin.created_at}</TableCell>
                  <TableCell className="text-center p-2.5">
                    <span className="font-mono font-black text-xs text-primary bg-primary/10 rounded-md px-2 py-0.5 inline-block">
                      {spin.result.toString().padStart(3, '0')}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] font-bold text-foreground p-2.5">
                    {formatCurrency(spin.total_stake)}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-[11px] font-bold p-2.5 ${spin.total_payout > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                    {spin.total_payout > 0 ? `+${formatCurrency(spin.total_payout)}` : '-'}
                  </TableCell>
                  <TableCell className="text-center p-2.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black ${
                      spin.outcome === 'WON' ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
                    }`}>
                      {spin.outcome}
                    </span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Picks breakdown -- Single, Double, Triple. Each pick is a
              two-part chip: the number on top, the coin stake in a colored
              pill below it -- green for the winning pick, red for every
              other one. */}
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

/** One Single/Double/Triple picks section -- a large section title followed
 * by a wrapping row of number "chips" (the digit on top, the coin stake in
 * a colored pill below it). Green chip = the winning pick; red pill = every
 * other one. Extracted since all 3 sections are structurally identical,
 * differing only in title, data, the winning-pick check, and how many
 * digits `pad` pads a shorter stored key up to (single digits are already
 * exactly 1 character, so pad=1 is a no-op; double/triple pad up to 2/3). */
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
      <h3 className="text-2xl font-black text-foreground mb-3">{title}</h3>
      {entries.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {entries.map(([num, val]) => {
            const winning = isWinning(num)
            const display = num.padStart(pad, '0')
            return (
              <div key={num} className="flex flex-col rounded-xl overflow-hidden shadow-xs min-w-[64px]">
                <div className={`flex items-center justify-center px-3 py-2 text-2xl font-black font-mono ${
                  winning ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary/50 text-foreground'
                }`}>
                  {display}
                </div>
                <div className={`flex items-center justify-center px-2 py-1 text-[11px] font-bold font-mono ${
                  winning ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                }`}>
                  {formatCurrency(val)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">{emptyText}</p>
      )}
    </div>
  )
}
