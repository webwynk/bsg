"use client"

import * as React from 'react'
import { Eye } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { GamePlayDetailDialog } from '@/components/game-play-detail-dialog'
import { TicketArrow, TicketList, TicketTableRow, useRoundTickets } from '@/components/round-tickets'
import { formatCurrency } from '@/lib/utils'
import { roundId } from '@/lib/round-id'
import type { PlayerGamePlay } from '@/app/agent/players/actions'

/**
 * Triple Chance plays as rows for the Player History page
 * (components/player-game-history.tsx): cards on phones and tablets, a table from the large
 * breakpoint, the detail popup (eye icon) and the round's Print tickets. Moved
 * here unchanged from the agent and superadmin player pages (2026-11-07), where
 * the same markup was copied twice. The "SINGLE + DOUBLE" label (which kinds of
 * bets the round had) stays on every row; the page's old Single/Double/Triple
 * filter was removed. The page passes one page of plays already filtered by the
 * server (date range, Won/Lost, round ID); this file only draws them.
 */
export function TripleChancePlayList({
  plays,
  playerIdentifier,
  playerFullName,
  playerUsername,
}: {
  plays: PlayerGamePlay[]
  /** The player's id (for the round's Print tickets). */
  playerIdentifier: string
  playerFullName: string
  playerUsername: string
}) {
  const tickets = useRoundTickets(playerIdentifier, 'TC', plays)
  return (
    <>
    {/* --- MOBILE CARDS VIEW (< sm) --- */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 lg:hidden p-3 bg-background/50">
      {plays.map((spin) => {
        const isWon = spin.total_payout > 0
        return (
          <Card key={spin.hand_id} className="p-3 bg-card border-border/70 rounded-xl space-y-2 shadow-xs">
            {/* Card Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 min-w-0">
                <span className="font-mono text-xs font-black text-foreground">{roundId('TC', spin.round_number)}</span>
                <span className="text-xs font-semibold text-muted-foreground truncate">{'Triple Chance'}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black ${
                  isWon ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
                }`}>
                  {isWon ? 'WON' : 'LOST'}
                </span>
                <TicketArrow tickets={tickets} round={spin.round_number} />
                <GamePlayDetailDialog
                  spin={spin}
                  playerFullName={playerFullName}
                  playerUsername={playerUsername}
                  tickets={tickets.ticketsFor(spin.round_number)}
                  trigger={
                    <button
                      className="p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
                      aria-label="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  }
                />
              </div>
            </div>

            {/* Card Sub-header */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{spin.mode}</span>
                {/* Issue #100: this round's own pinned bonus multiplier. */}
                <span className={`font-mono font-black px-1.5 py-0.5 rounded ${
                  spin.bonus_multiplier === 1
                    ? 'text-muted-foreground bg-secondary/40'
                    : 'text-amber-400 bg-amber-500/10'
                }`}>
                  {spin.bonus_multiplier === 1 ? 'N' : `${spin.bonus_multiplier}X`}
                </span>
              </div>
              <span className="font-mono">{spin.created_at}</span>
            </div>

            {/* Card Metrics Strip */}
            <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-secondary/30 text-center text-xs">
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Result</span>
                <span className="font-mono font-black text-primary bg-primary/10 px-1.5 py-0.2 rounded inline-block">
                  {spin.result.toString().padStart(3, '0')}
                </span>
              </div>
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Bet</span>
                <span className="font-mono font-black text-foreground">{formatCurrency(spin.total_stake)}</span>
              </div>
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Win</span>
                <span className={`font-mono font-black ${spin.total_payout > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                  {spin.total_payout > 0 ? `+${formatCurrency(spin.total_payout)}` : '-'}
                </span>
              </div>
            </div>
            <TicketList tickets={tickets} round={spin.round_number} />
          </Card>
        )
      })}
    </div>

    {/* --- DESKTOP TABLE VIEW (>= sm) --- */}
    <div className="hidden lg:block overflow-x-auto table-scroll">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent bg-secondary/20">
            <TableHead className="w-8"></TableHead>
            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Round ID</TableHead>
            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[100px]">Game</TableHead>
            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[120px]">Mode</TableHead>
            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[130px]">Date & Time</TableHead>
            <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win Result</TableHead>
            <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[60px]">Bonus</TableHead>
            <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Bet</TableHead>
            <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win</TableHead>
            <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[70px]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plays.map((spin) => (
            <React.Fragment key={spin.hand_id}>
              <TableRow className="border-border hover:bg-secondary/30 transition-colors">
                <TableCell className="p-2">
                  <div className="flex items-center gap-1">
                    <GamePlayDetailDialog
                      spin={spin}
                      playerFullName={playerFullName}
                      playerUsername={playerUsername}
                      tickets={tickets.ticketsFor(spin.round_number)}
                      trigger={
                        <button
                          className="p-1 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
                          aria-label="View Details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                    <TicketArrow tickets={tickets} round={spin.round_number} />
                  </div>
                </TableCell>
                <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5">{roundId('TC', spin.round_number)}</TableCell>
                <TableCell className="text-[11px] font-semibold text-foreground p-2.5">{'Triple Chance'}</TableCell>
                <TableCell className="text-[11px] font-bold text-primary p-2.5">{spin.mode}</TableCell>
                <TableCell className="text-[11px] text-muted-foreground font-mono whitespace-nowrap p-2.5">{spin.created_at}</TableCell>
                <TableCell className="text-center p-2.5">
                  <span className="font-mono font-black text-xs text-primary bg-primary/10 rounded-md px-2 py-0.5 inline-block">
                    {spin.result.toString().padStart(3, '0')}
                  </span>
                </TableCell>
                <TableCell className="text-center p-2.5">
                  {/* Issue #100: this round's own pinned bonus multiplier. */}
                  <span className={`font-mono font-black text-[10px] rounded-md px-1.5 py-0.5 inline-block ${
                    spin.bonus_multiplier === 1
                      ? 'text-muted-foreground bg-secondary/40'
                      : 'text-amber-400 bg-amber-500/10'
                  }`}>
                    {spin.bonus_multiplier === 1 ? 'N' : `${spin.bonus_multiplier}X`}
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
              <TicketTableRow tickets={tickets} round={spin.round_number} colSpan={10} />
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>

    </>
  )
}
