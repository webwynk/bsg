'use client'

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ResponsivePagination } from '@/components/responsive-pagination'
import { ErrorBanner } from '@/components/error-banner'
import { RangeFilter, StatTile, type RangeChoice } from '@/components/range-filter'
import { useLiveSync } from '@/hooks/use-live-sync'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import type { LiveTable } from '@/components/live-data-provider'
import { formatCurrency } from '@/lib/utils'
import { presetRange, rangeLabel, type DayRange, type GameplayPreset } from '@/lib/gameplay-range'
import { PNL_PAGE_SIZE, dayLabel, dayNet, pnlPage, pnlTotals, type PnlDay } from '@/lib/pnl-days'
import { getPlayerPnlDaysAction } from '@/app/agent/players/player-game-history-actions'

/** The P&L tab's own filter, in Hasan's order (the calendar comes first). */
const PNL_PRESETS: readonly GameplayPreset[] = ['today', '7d', 'lifetime']
const LIVE_TABLES: LiveTable[] = ['rounds', 'lucky_card_rounds', 'spin2win_rounds', 'lucky16_rounds', 'coin_ledger']

type Loader = typeof getPlayerPnlDaysAction

/**
 * P&L Audit tab of the superadmin agent page, for the SELECTED PLAYER only
 * (2026-11-08 redesign; it used to list every player of the agent and was
 * driven by the page's header toggles).
 *
 * Its own filter, inside the tab only: Pick date (a day or range on the
 * calendar) | Today (default) | 7 days | Lifetime, in India time (a day runs
 * 12:00 AM to 11:59 PM IST, so "Today" starts fresh at midnight IST). Four
 * cards for the period (Net P/L, Bets In, Wins Out, Margin) and one row per IST
 * day the player played -- Date | Plays | Bets | Wins | Net P/L | Margin --
 * newest first, 10 per page. All four games, phone bets and Print tickets
 * together. Data: getPlayerPnlDaysAction (staff_player_daily_money), kept fresh
 * by useLiveSync ('normal': realtime + 10 s poll).
 */
export function PlayerPnlAudit({
  playerIdentifier,
  playerUsername,
  agentUsername,
  loadDays = getPlayerPnlDaysAction,
}: {
  playerIdentifier: string
  playerUsername: string
  agentUsername: string
  /** Only so the tab can be rendered with sample data; the page always uses the server action. */
  loadDays?: Loader
}) {
  const [choice, setChoice] = React.useState<RangeChoice>({ preset: 'today', custom: null })
  const [page, setPage] = React.useState(1)
  const [loaded, setLoaded] = React.useState<{ key: string; days: PnlDay[] } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const request = useRequestGeneration()

  // What an answer belongs to: (player, filter). Anything else shows skeletons.
  const key = `${playerIdentifier}|${choice.preset}|${choice.custom?.from}|${choice.custom?.to}`
  const current = React.useRef({ playerIdentifier, choice, key })
  React.useEffect(() => { current.current = { playerIdentifier, choice, key } })

  const load = React.useCallback(() => {
    const f = current.current
    const range: DayRange | null = f.choice.preset ? presetRange(f.choice.preset, new Date()) : f.choice.custom
    const token = request.nextGeneration()
    return loadDays(f.playerIdentifier, range).then((res) => {
      if (!request.isCurrent(token)) return
      setError(res.error)
      if (!res.error) setLoaded({ key: f.key, days: res.days })
    }).catch((e) => {
      if (!request.isCurrent(token)) return
      setError(e instanceof Error ? e.message : "Could not load the player's P&L.")
    })
  }, [loadDays, request])

  const { refresh } = useLiveSync(LIVE_TABLES, load, 'normal')
  const lastKey = React.useRef(key)
  React.useEffect(() => {
    if (lastKey.current === key) return
    lastKey.current = key
    refresh()
  }, [key, refresh])

  const ready = loaded !== null && loaded.key === key
  const days = ready ? loaded.days : []
  const totals = pnlTotals(days)
  const pageInfo = pnlPage(days, page)
  const shownRange = choice.preset ? presetRange(choice.preset, new Date()) : choice.custom
  const netClass = (n: number) => (n >= 0 ? 'text-emerald-500' : 'text-red-500')
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${formatCurrency(n)}`

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
        <RangeFilter value={choice} onChange={(next) => { setChoice(next); setPage(1) }} presets={PNL_PRESETS} calendarFirst />
        <p className="text-[10px] sm:text-[11px] text-muted-foreground font-semibold">
          @{playerUsername} · agent @{agentUsername} · {rangeLabel(shownRange)}{shownRange ? ' (IST)' : ''}
        </p>
      </div>

      <ErrorBanner error={error} />

      {/* Four cards for the chosen period: 2x2 on a phone, one row from sm */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile label="Net P/L" hint="House: bet minus won" loading={!ready} valueClass={netClass(totals.net)} value={signed(totals.net)} />
        <StatTile label="Bets (In)" hint={`${totals.plays.toLocaleString('en-IN')} plays`} loading={!ready} value={formatCurrency(totals.stake)} />
        <StatTile label="Wins (Out)" hint="Paid to the player" loading={!ready} valueClass="text-amber-500" value={formatCurrency(totals.payout)} />
        <StatTile label="Margin" hint="Net ÷ bets" loading={!ready} valueClass={netClass(totals.net)} value={`${totals.marginPct.toFixed(1)}%`} />
      </div>

      <Card className="border-border/80 bg-card rounded-xl overflow-hidden shadow-xs">
        {!ready ? (
          <div className="p-4 space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-xl bg-secondary/20 animate-pulse border border-border/40" />
            ))}
          </div>
        ) : days.length === 0 ? (
          <div className="p-10 text-center text-xs text-muted-foreground font-medium">
            No plays by @{playerUsername} in this period.
          </div>
        ) : (
          <>
            {/* Cards on phones and tablets (2 columns from sm) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 lg:hidden p-3 bg-background/50">
              {pageInfo.items.map((d) => {
                const { net, marginPct } = dayNet(d)
                return (
                  <Card key={d.day} className="p-3 bg-card border-border/70 rounded-xl space-y-2 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-black text-foreground">{dayLabel(d.day)}</span>
                      <span className={`font-mono text-xs font-black ${netClass(net)}`}>{signed(net)}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 p-2 rounded-lg bg-secondary/30 text-center text-[11px]">
                      {[['Plays', d.plays.toLocaleString('en-IN'), 'text-foreground'], ['Bets', formatCurrency(d.stake), 'text-foreground'], ['Wins', formatCurrency(d.payout), 'text-amber-500'], ['Margin', `${marginPct.toFixed(1)}%`, netClass(net)]].map(([label, value, cls]) => (
                        <div key={label} className="min-w-0">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">{label}</span>
                          <span className={`font-mono font-black truncate block ${cls}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                )
              })}
            </div>

            {/* Table on wide screens */}
            <div className="hidden lg:block overflow-x-auto table-scroll">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[150px]">Date (IST)</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider">Plays</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider">Bets (In)</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider">Wins (Out)</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider">Net P/L (+/−)</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider">Margin %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageInfo.items.map((d) => {
                    const { net, marginPct } = dayNet(d)
                    return (
                      <TableRow key={d.day} className="border-border hover:bg-secondary/30 transition-colors">
                        <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5">{dayLabel(d.day)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] text-muted-foreground p-2.5">{d.plays.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] font-bold text-foreground p-2.5">{formatCurrency(d.stake)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] font-bold text-amber-500 p-2.5">{formatCurrency(d.payout)}</TableCell>
                        <TableCell className={`text-right font-mono text-[11px] font-black p-2.5 ${netClass(net)}`}>{signed(net)}</TableCell>
                        <TableCell className={`text-right font-mono text-[11px] font-bold p-2.5 ${netClass(net)}`}>{marginPct.toFixed(1)}%</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {days.length > PNL_PAGE_SIZE && (
              <div className="p-3 border-t border-border/60">
                <ResponsivePagination currentPage={pageInfo.page} totalPages={pageInfo.totalPages} onPageChange={setPage} totalItems={days.length} itemsPerPage={PNL_PAGE_SIZE} />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
