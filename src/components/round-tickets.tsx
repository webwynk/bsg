"use client"

import * as React from 'react'
import { ChevronDown, Ticket } from 'lucide-react'
import { TableCell, TableRow } from '@/components/ui/table'
import { getPlayerTicketsAction } from '@/app/agent/players/player-tickets-actions'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import { ticketSummary, type PlayerTicket, type TicketGame, type TicketsByRound } from '@/lib/player-tickets'
import { formatCurrency } from '@/lib/utils'

export interface RoundTickets {
  ticketsFor: (round: number) => PlayerTicket[]
  isOpen: (round: number) => boolean
  toggle: (round: number) => void
}

/**
 * Printed tickets for the rounds on screen. Loads again only when those rounds,
 * or their stake or result, change, so the history's 3-second poll adds no read.
 * A failed read shows no arrow: tickets must never stop a history loading.
 */
export function useRoundTickets(
  player: string | undefined,
  game: TicketGame,
  plays: ReadonlyArray<{ round_number: number; total_stake: number; outcome: string }>,
): RoundTickets {
  const owner = `${player}|${game}`
  const [loaded, setLoaded] = React.useState<{ owner: string; tickets: TicketsByRound } | null>(null)
  const [open, setOpen] = React.useState<{ owner: string; rounds: number[] }>({ owner, rounds: [] })
  const request = useRequestGeneration()

  const rounds = plays.map(play => play.round_number)
  const signature = plays.map(play => `${play.round_number}:${play.total_stake}:${play.outcome}`).join(',')
  const roundsRef = React.useRef(rounds)
  React.useEffect(() => {
    roundsRef.current = rounds
  })

  React.useEffect(() => {
    if (!player || signature === '') return
    const token = request.nextGeneration()
    getPlayerTicketsAction(player, game, roundsRef.current).then(res => {
      if (!request.isCurrent(token)) return
      if (res.error) console.error('getPlayerTicketsAction:', res.error)
      else setLoaded({ owner: `${player}|${game}`, tickets: res.tickets })
    }).catch(e => console.error('getPlayerTicketsAction:', e))
  }, [player, game, signature, request])

  const isCurrent = loaded?.owner === owner
  const openRounds = open.owner === owner ? open.rounds : []

  return {
    ticketsFor: round => (isCurrent ? loaded.tickets[round] ?? [] : []),
    isOpen: round => openRounds.includes(round),
    toggle: round => setOpen({
      owner,
      rounds: openRounds.includes(round) ? openRounds.filter(r => r !== round) : [...openRounds, round],
    }),
  }
}

/** The arrow on a round with tickets. Renders nothing on any other round. */
export function TicketArrow({ tickets, round }: { tickets: RoundTickets; round: number }) {
  const list = tickets.ticketsFor(round)
  if (list.length === 0) return null
  const open = tickets.isOpen(round)
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${list.length} ${list.length === 1 ? 'ticket' : 'tickets'}`}
      onClick={() => tickets.toggle(round)}
      className="inline-flex items-center gap-0.5 rounded-lg bg-primary/10 p-1 text-primary hover:bg-primary/20 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="font-mono text-[10px] font-black leading-none">{list.length}</span>
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

/** One round's tickets, each with its bet and win; winning tickets are tinted. */
export function TicketList({ tickets, round }: { tickets: RoundTickets; round: number }) {
  const list = tickets.ticketsFor(round)
  if (list.length === 0 || !tickets.isOpen(round)) return null
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
        <Ticket className="h-3.5 w-3.5" />
        <span>{list.length} {list.length === 1 ? 'Ticket' : 'Tickets'}</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {list.map(ticket => {
          const won = ticket.win > 0
          return (
            <div
              key={ticket.ticket_code}
              className={`rounded-lg border px-2.5 py-1.5 ${won ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-border/70 bg-card'}`}
            >
              <p className="truncate font-mono text-[11px] font-black text-foreground">{ticket.ticket_code}</p>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] font-mono font-bold">
                <span className="text-muted-foreground">Bet {formatCurrency(ticket.total_stake)}</span>
                <span className={won ? 'text-success-text' : 'text-muted-foreground'}>
                  {ticket.is_drawn ? (won ? `Win +${formatCurrency(ticket.win)}` : 'Win -') : 'Waiting'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** TicketList as a full-width row under a round in a table. */
export function TicketTableRow({ tickets, round, colSpan }: { tickets: RoundTickets; round: number; colSpan: number }) {
  if (tickets.ticketsFor(round).length === 0 || !tickets.isOpen(round)) return null
  return (
    <TableRow className="border-border bg-secondary/20 hover:bg-secondary/20">
      <TableCell colSpan={colSpan} className="p-3 whitespace-normal">
        <TicketList tickets={tickets} round={round} />
      </TableCell>
    </TableRow>
  )
}

/**
 * A Print player's tickets inside a play popup, on its white panel in both
 * themes: number, bet, win and contents. The list scrolls by itself, so hundreds
 * of tickets leave the rest of the popup in reach.
 */
export function PopupTicketList({ game, tickets }: { game: TicketGame; tickets: PlayerTicket[] | undefined }) {
  if (!tickets || tickets.length === 0) return null
  return (
    <div className="space-y-1.5 pb-1">
      <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500">
        {tickets.length} {tickets.length === 1 ? 'Ticket' : 'Tickets'}
      </span>
      <div className="max-h-80 space-y-1.5 overflow-y-auto">
        {tickets.map(ticket => {
          const won = ticket.win > 0
          return (
            <div
              key={ticket.ticket_code}
              className={`rounded-lg border px-2.5 py-1.5 ${won ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200'}`}
            >
              <p className="truncate font-mono text-[11px] font-black text-slate-900">{ticket.ticket_code}</p>
              <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[11px] font-bold">
                <span className="text-slate-500">Bet {formatCurrency(ticket.total_stake)}</span>
                <span className={won ? 'text-emerald-700' : 'text-slate-400'}>
                  {ticket.is_drawn ? (won ? `Win +${formatCurrency(ticket.win)}` : 'Win -') : 'Waiting'}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-line break-words border-t border-slate-200/70 pt-1 font-mono text-[11px] text-slate-600">
                {ticketSummary(game, ticket.items, formatCurrency)}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
