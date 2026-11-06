"use client"

import Link from 'next/link'
import { ChevronRight, Loader2, Printer } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { accountCodeLabel } from '@/lib/account-codes'
import type { DesktopPlayerRow } from '@/lib/desktop-players'
import { playerStatus } from '@/lib/player-status'
import { formatCurrency } from '@/lib/utils'

/** Green dot and word for whether the player is online right now. */
function OnlineMark({ player }: { player: DesktopPlayerRow }) {
  const online = player.is_online && player.is_active
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
      {online ? 'Online' : 'Offline'}
    </span>
  )
}

/** Shown only when the player is blocked, so a normal row stays quiet. */
function BlockedBadge({ player }: { player: DesktopPlayerRow }) {
  if (player.is_active) return null
  const status = playerStatus(player)
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-black ${status.badgeClass}`}>
      {status.label}
    </span>
  )
}

/** The Print switch, with the word beside it so ON and OFF never rely on colour. */
function PrintSwitch({ player, busy, onToggle }: {
  player: DesktopPlayerRow
  busy: boolean
  onToggle: (player: DesktopPlayerRow) => void
}) {
  const on = player.print_enabled
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Print for ${player.username}`}
      disabled={busy}
      onClick={() => onToggle(player)}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait"
    >
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`}>
        <span className={`absolute top-0.5 left-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-5' : ''}`}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
        </span>
      </span>
      <span className={`w-7 text-left text-xs font-black ${on ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
        {on ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}

/** View-only Print state, for screens that may not change it. */
function PrintBadge({ on }: { on: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${
      on
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'border-border bg-secondary/40 text-muted-foreground'
    }`}>
      <Printer className="h-3 w-3" />
      {on ? 'ON' : 'OFF'}
    </span>
  )
}

/**
 * The players of the Desktop Player tab: a table on a PC, and one card per
 * player on a phone (two across on a tablet), so nothing scrolls sideways. historyHref
 * returns null when a player has no history page to open. Without onToggle the
 * Print state is view only. An agent's own list hides the agent with showAgent.
 */
export function DesktopPlayerList({ players, busyId, historyHref, onToggle, showAgent = true }: {
  players: DesktopPlayerRow[]
  busyId: string | null
  historyHref: (player: DesktopPlayerRow) => string | null
  onToggle?: (player: DesktopPlayerRow) => void
  showAgent?: boolean
}) {
  const print = (player: DesktopPlayerRow) => onToggle
    ? <PrintSwitch player={player} busy={busyId === player.id} onToggle={onToggle} />
    : <PrintBadge on={player.print_enabled} />

  return (
    <>
      <div className="hidden lg:block rounded-xl border border-border/80 bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">Player</TableHead>
              {showAgent && <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">Agent</TableHead>}
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-muted-foreground">Balance</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">Print</TableHead>
              <TableHead className="w-10"><span className="sr-only">History</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.map(player => {
              const href = historyHref(player)
              return (
                <TableRow key={player.id}>
                  <TableCell className="max-w-[220px]">
                    <p className="truncate text-sm font-extrabold text-foreground">{player.full_name}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      @{player.username} &bull; {accountCodeLabel(player.account_code)}
                    </p>
                  </TableCell>
                  {showAgent && (
                    <TableCell className="max-w-[140px] truncate text-xs font-bold text-muted-foreground">
                      {player.agent_name ?? '-'}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono text-sm font-black text-foreground">
                    {formatCurrency(player.coin_balance)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <OnlineMark player={player} />
                      <BlockedBadge player={player} />
                    </div>
                  </TableCell>
                  <TableCell>{print(player)}</TableCell>
                  <TableCell className="text-right">
                    {href && (
                      <Link
                        href={href}
                        aria-label={`Open history of ${player.username}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2 md:grid-cols-2 lg:hidden">
        {players.map(player => {
          const href = historyHref(player)
          return (
            <div key={player.id} className="rounded-xl border border-border/80 bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-foreground">{player.full_name}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    @{player.username} &bull; {accountCodeLabel(player.account_code)}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm font-black text-foreground">
                  {formatCurrency(player.coin_balance)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-muted-foreground">
                {showAgent && <span className="min-w-0 truncate">Agent: {player.agent_name ?? '-'}</span>}
                <OnlineMark player={player} />
                <BlockedBadge player={player} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">Print</span>
                  {print(player)}
                </div>
                {href && (
                  <Link
                    href={href}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-extrabold text-primary hover:bg-secondary/60"
                  >
                    History <ChevronRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
