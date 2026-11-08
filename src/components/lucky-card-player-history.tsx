"use client"

import * as React from 'react'
import { Eye } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LuckyCardPlayDetailDialog } from '@/components/lucky-card-play-detail-dialog'
import { TicketArrow, TicketList, TicketTableRow, useRoundTickets } from '@/components/round-tickets'
import { formatCurrency } from '@/lib/utils'
import {
  bonusLabel,
  suitIsRed,
  suitSymbol,
  type LcRank,
  type LcSuit,
  type PlayOutcome,
  type PlayerLuckyCardPlay,
} from '@/lib/lucky-card'
import { roundId } from '@/lib/round-id'

function CardFace({ rank, suit }: { rank: LcRank; suit: LcSuit }) {
  return (
    <span className={`font-black ${suitIsRed(suit) ? 'text-red-400' : 'text-foreground'}`}>
      {rank}{suitSymbol(suit)}
    </span>
  )
}

function BonusBadge({ bonus }: { bonus: number }) {
  return (
    <span className={`font-mono font-black text-[10px] rounded-md px-1.5 py-0.5 inline-block ${
      bonus === 1 ? 'text-muted-foreground bg-secondary/40' : 'text-amber-400 bg-amber-500/10'
    }`}>
      {bonusLabel(bonus)}
    </span>
  )
}

const OUTCOME_STYLE: Record<PlayOutcome, string> = {
  WON: 'bg-success-bg text-success-text border border-emerald-500/20',
  LOST: 'bg-danger-bg text-danger-text border border-red-500/20',
  PENDING: 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
}

function OutcomeBadge({ outcome }: { outcome: PlayOutcome }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black ${OUTCOME_STYLE[outcome]}`}>
      {outcome}
    </span>
  )
}

function WinText({ amount }: { amount: number }) {
  return <>{amount > 0 ? `+${formatCurrency(amount)}` : '-'}</>
}

/**
 * Lucky Card plays as rows for the Player History page (components/player-game-history.tsx):
 * cards on phones and tablets, a table from the large breakpoint, the detail popup (eye icon)
 * and the round's Print tickets, unchanged. The page passes one page of plays
 * already filtered by the server (date range, Won/Lost, round ID); this file only
 * draws them. (Its own summary strip and "last 100 plays" loading were removed
 * on 2026-11-07: the page's tiles and paged list replace them.)
 */
export function LuckyCardPlayList({
  plays,
  playerIdentifier,
  playerFullName,
  playerUsername,
}: {
  plays: PlayerLuckyCardPlay[]
  /** The player's id (for the round's Print tickets). */
  playerIdentifier: string
  playerFullName: string
  playerUsername: string
}) {
  const tickets = useRoundTickets(playerIdentifier, 'LC', plays)
  return (
    <>
    {/* Cards on phones */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 lg:hidden p-3 bg-background/50">
      {plays.map(play => (
        <Card key={play.hand_id} className="p-3 bg-card border-border/70 rounded-xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <span className="font-mono text-xs font-black text-foreground">{roundId('LC', play.round_number)}</span>
              <span className="text-xs font-semibold text-muted-foreground truncate">Lucky Card</span>
            </div>
            <div className="flex items-center space-x-2">
              <OutcomeBadge outcome={play.outcome} />
              <TicketArrow tickets={tickets} round={play.round_number} />
              <LuckyCardPlayDetailDialog
                play={play}
                playerFullName={playerFullName}
                playerUsername={playerUsername}
                tickets={tickets.ticketsFor(play.round_number)}
                trigger={
                  <button className="p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none" aria-label="View Details">
                    <Eye className="h-4 w-4" />
                  </button>
                }
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground pt-1 border-t border-border/40">
            <div className="flex items-center gap-1.5 min-w-0">
              <BonusBadge bonus={play.bonus_multiplier} />
            </div>
            <span className="font-mono shrink-0">{play.created_at}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-secondary/30 text-center text-xs">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Winning Card</span>
              <span className="font-mono text-sm">
                {play.rank && play.suit ? <CardFace rank={play.rank} suit={play.suit} /> : <span className="text-muted-foreground">—</span>}
              </span>
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Bet</span>
              <span className="font-mono font-black text-foreground">{formatCurrency(play.total_stake)}</span>
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Win</span>
              <span className={`font-mono font-black ${play.total_payout > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                <WinText amount={play.total_payout} />
              </span>
            </div>
          </div>
          <TicketList tickets={tickets} round={play.round_number} />
        </Card>
      ))}
    </div>

    {/* Table on wide screens */}
    <div className="hidden lg:block overflow-x-auto table-scroll">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent bg-secondary/20">
            <TableHead className="w-8"></TableHead>
            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[90px]">Round</TableHead>
            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[100px]">Game</TableHead>
            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[130px]">Date & Time</TableHead>
            <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win Card</TableHead>
            <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[60px]">Bonus</TableHead>
            <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Bet</TableHead>
            <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win</TableHead>
            <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[70px]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plays.map(play => (
            <React.Fragment key={play.hand_id}>
              <TableRow className="border-border hover:bg-secondary/30 transition-colors">
                <TableCell className="p-2">
                  <div className="flex items-center gap-1">
                    <LuckyCardPlayDetailDialog
                      play={play}
                      playerFullName={playerFullName}
                      playerUsername={playerUsername}
                      tickets={tickets.ticketsFor(play.round_number)}
                      trigger={
                        <button className="p-1 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none" aria-label="View Details">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                    <TicketArrow tickets={tickets} round={play.round_number} />
                  </div>
                </TableCell>
                <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5">{roundId('LC', play.round_number)}</TableCell>
                <TableCell className="text-[11px] font-semibold text-foreground p-2.5">Lucky Card</TableCell>
                <TableCell className="text-[11px] text-muted-foreground font-mono whitespace-nowrap p-2.5">{play.created_at}</TableCell>
                <TableCell className="text-center p-2.5 text-sm font-mono">
                  {play.rank && play.suit ? <CardFace rank={play.rank} suit={play.suit} /> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-center p-2.5"><BonusBadge bonus={play.bonus_multiplier} /></TableCell>
                <TableCell className="text-right font-mono text-[11px] font-bold text-foreground p-2.5">{formatCurrency(play.total_stake)}</TableCell>
                <TableCell className={`text-right font-mono text-[11px] font-bold p-2.5 ${play.total_payout > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                  <WinText amount={play.total_payout} />
                </TableCell>
                <TableCell className="text-center p-2.5"><OutcomeBadge outcome={play.outcome} /></TableCell>
              </TableRow>
              <TicketTableRow tickets={tickets} round={play.round_number} colSpan={9} />
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>

    </>
  )
}
