"use client"

import * as React from 'react'
import { Eye, Activity } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ResponsivePagination } from '@/components/responsive-pagination'
import { ErrorBanner } from '@/components/error-banner'
import { LuckyCardPlayDetailDialog } from '@/components/lucky-card-play-detail-dialog'
import { useLiveSync } from '@/hooks/use-live-sync'
import type { LiveTable } from '@/components/live-data-provider'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import { formatCurrency } from '@/lib/utils'
import { getPlayerLuckyCardHistoryAction } from '@/app/agent/players/lucky-card-player-actions'
import {
  bonusLabel,
  filterPlays,
  istDayKey,
  paginate,
  suitIsRed,
  suitSymbol,
  summarizePlays,
  type LcRank,
  type LcSuit,
  type PlayOutcome,
  type PlayOutcomeFilter,
  type PlayerLuckyCardPlay,
} from '@/lib/lucky-card'

/**
 * The "Lucky Card" side of the Game Plays tab on the agent and superadmin player
 * pages (spec 13.2, 17AT): a performance strip of its own, the player's last 100
 * Lucky Card plays as cards on phones and a table on wide screens, and the
 * detail popup. The page's date and WON/LOST pills (filterDate, filterOutcome)
 * apply here too; the Triple Chance-only SINGLE/DOUBLE/TRIPLE pills do not.
 *
 * Loaded only while it is shown (the page renders it only for the Lucky Card
 * side), so the Triple Chance side costs nothing extra: one load on opening and
 * then every 3 seconds, or at once when the shared live signal reports a change
 * of lucky_card_rounds (a round drawn and settled), through useLiveSync.
 */

const ITEMS_PER_PAGE = 5
const LIVE_TABLES: LiveTable[] = ['lucky_card_rounds']

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

export function LuckyCardPlayerHistory({
  playerIdentifier,
  playerFullName,
  playerUsername,
  filterDate,
  filterOutcome,
}: {
  /** The player's id or username, whatever the page already passes to the Triple Chance history. */
  playerIdentifier: string
  playerFullName: string
  playerUsername: string
  /** The page's day filter ("2026-10-07" in Indian time), undefined = every day. */
  filterDate: string | undefined
  filterOutcome: PlayOutcomeFilter
}) {
  // The plays belong to the player they were loaded for; a different player
  // shows the skeleton until their own plays arrive.
  const [loaded, setLoaded] = React.useState<{ player: string; plays: PlayerLuckyCardPlay[] } | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  // The Indian-time day of the last load. Date.now() cannot be read while rendering.
  const [todayKey, setTodayKey] = React.useState('')
  const [scope, setScope] = React.useState<'today' | 'lifetime'>('today')
  const [page, setPage] = React.useState(1)
  const [lastKey, setLastKey] = React.useState(`${playerIdentifier}|${filterDate}|${filterOutcome}`)

  // Back to page 1 when the player or a filter changes -- adjusted during render
  // (React's own pattern for this), not in an effect, so no wrong frame is drawn.
  const key = `${playerIdentifier}|${filterDate}|${filterOutcome}`
  if (key !== lastKey) {
    setLastKey(key)
    setPage(1)
  }

  const request = useRequestGeneration()
  // Returned (not fire-and-forget) so useLiveSync can skip a poll tick while this
  // one is still in flight (Issue #93).
  const loadPlays = React.useCallback(() => {
    const token = request.nextGeneration()
    return getPlayerLuckyCardHistoryAction(playerIdentifier).then(res => {
      if (!request.isCurrent(token)) return
      setLoadError(res.error)
      // A failed load keeps the last good plays of this player on screen.
      if (!res.error) {
        setLoaded({ player: playerIdentifier, plays: res.plays })
        setTodayKey(istDayKey(new Date().toISOString()))
      }
    }).catch(e => {
      if (!request.isCurrent(token)) return
      console.error('Error loading Lucky Card history:', e)
      setLoadError(e instanceof Error ? e.message : 'Could not load Lucky Card history.')
    })
  }, [request, playerIdentifier])

  const { refresh } = useLiveSync(LIVE_TABLES, loadPlays, 'fast')

  // useLiveSync loads on mount and on every tick, but not when only the player
  // changes: load at once for the new player. Not on the first appearance, which
  // useLiveSync already loads (a second load would only double the first).
  const lastPlayerRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const previous = lastPlayerRef.current
    lastPlayerRef.current = playerIdentifier
    if (previous === null || previous === playerIdentifier) return
    ;(async () => {
      refresh()
    })()
  }, [playerIdentifier, refresh])

  const isLoading = loaded === null || loaded.player !== playerIdentifier
  // Nothing loaded for this player and the load failed: say so instead of showing
  // grey loading bars for ever (the next 3-second try still runs and recovers).
  const unavailable = isLoading && loadError !== null
  const plays = isLoading ? [] : loaded.plays
  const filtered = filterPlays(plays, filterDate, filterOutcome)
  const pageInfo = paginate(filtered, page, ITEMS_PER_PAGE)
  const summary = summarizePlays(plays, scope, todayKey)

  return (
    <div className="space-y-3 p-3 bg-background/50">
      <ErrorBanner error={loadError} />

      {/* Lucky Card's own performance strip (settled plays only) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center space-x-1.5">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-[10px] font-black uppercase tracking-wider text-foreground">
              Lucky Card Performance Summary
            </h3>
            <span className="text-[9px] text-muted-foreground">(settled plays)</span>
          </div>
          <div className="flex items-center bg-secondary/40 border border-border/60 rounded-lg p-0.5 text-[9px] font-bold">
            {(['today', 'lifetime'] as const).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => setScope(option)}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                  scope === option ? 'bg-primary text-primary-foreground font-black shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {option === 'today' ? 'Today' : 'Lifetime'}
              </button>
            ))}
          </div>
        </div>

        {unavailable ? null : isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[1, 2, 3, 4].map(i => (
              <Card key={i} className="p-2 bg-card border-border/60 animate-pulse space-y-1.5 rounded-xl">
                <div className="h-2.5 bg-secondary/80 rounded w-1/2" />
                <div className="h-4 bg-secondary/60 rounded w-3/4" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card className="bg-card border border-border/80 p-2.5 rounded-xl shadow-xs">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Plays</span>
              <span className="text-base font-mono font-black text-foreground">{summary.totalPlays}</span>
            </Card>
            <Card className="bg-card border border-border/80 p-2.5 rounded-xl shadow-xs">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Bet Volume</span>
              <span className="text-base font-mono font-black text-foreground">{formatCurrency(summary.totalBet)}</span>
            </Card>
            <Card className="bg-card border border-border/80 p-2.5 rounded-xl shadow-xs">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Win Payout</span>
              <span className="text-base font-mono font-black text-foreground">{formatCurrency(summary.totalWin)}</span>
            </Card>
            <Card className={`border p-2.5 rounded-xl shadow-xs ${
              summary.netGgr >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
            }`}>
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Net House GGR</span>
              <div className="flex items-center justify-between">
                <span className={`text-base font-mono font-black ${summary.netGgr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {summary.netGgr >= 0 ? `+${formatCurrency(summary.netGgr)}` : formatCurrency(summary.netGgr)}
                </span>
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                  summary.netGgr >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {summary.marginPct.toFixed(1)}%
                </span>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Card className="border-border/80 bg-card rounded-xl overflow-hidden shadow-xs">
        {unavailable ? (
          <div className="p-10 text-center text-xs text-muted-foreground font-medium">
            Lucky Card history is unavailable right now. It tries again automatically every few seconds.
          </div>
        ) : isLoading ? (
          <div className="p-4 space-y-2.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-secondary/20 animate-pulse border border-border/40">
                <div className="h-3.5 bg-secondary/80 rounded w-1/4" />
                <div className="h-3.5 bg-secondary/60 rounded w-1/3" />
                <div className="h-3.5 bg-secondary/70 rounded w-1/6" />
              </div>
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <>
            {/* Cards on phones */}
            <div className="space-y-2.5 sm:hidden p-3 bg-background/50">
              {pageInfo.items.map(play => (
                <Card key={play.hand_id} className="p-3 bg-card border-border/70 rounded-xl space-y-2 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="font-mono text-xs font-black text-foreground">#{play.round_number}</span>
                      <span className="text-xs font-semibold text-muted-foreground truncate">Lucky Card</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <OutcomeBadge outcome={play.outcome} />
                      <LuckyCardPlayDetailDialog
                        play={play}
                        playerFullName={playerFullName}
                        playerUsername={playerUsername}
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
                      <span className="font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded break-words min-w-0">{play.picks || '—'}</span>
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
                </Card>
              ))}
            </div>

            {/* Table on wide screens */}
            <div className="hidden sm:block overflow-x-auto table-scroll">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[90px]">Round</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[100px]">Game</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[140px]">Cards Bet</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[130px]">Date & Time</TableHead>
                    <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win Card</TableHead>
                    <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[60px]">Bonus</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Bet</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win</TableHead>
                    <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[70px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageInfo.items.map(play => (
                    <TableRow key={play.hand_id} className="border-border hover:bg-secondary/30 transition-colors">
                      <TableCell className="p-2">
                        <LuckyCardPlayDetailDialog
                          play={play}
                          playerFullName={playerFullName}
                          playerUsername={playerUsername}
                          trigger={
                            <button className="p-1 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none" aria-label="View Details">
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          }
                        />
                      </TableCell>
                      <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5">#{play.round_number}</TableCell>
                      <TableCell className="text-[11px] font-semibold text-foreground p-2.5">Lucky Card</TableCell>
                      <TableCell className="text-[11px] font-mono font-bold text-primary p-2.5">{play.picks || '—'}</TableCell>
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
                  ))}
                </TableBody>
              </Table>
            </div>

            {filtered.length > ITEMS_PER_PAGE && (
              <div className="p-3 border-t border-border/60">
                <ResponsivePagination
                  currentPage={pageInfo.page}
                  totalPages={pageInfo.totalPages}
                  onPageChange={setPage}
                  totalItems={filtered.length}
                  itemsPerPage={ITEMS_PER_PAGE}
                />
              </div>
            )}
          </>
        ) : (
          <div className="p-10 text-center text-xs text-muted-foreground font-medium">
            No Lucky Card play history recorded for the selected filter.
          </div>
        )}
      </Card>
    </div>
  )
}
