"use client"

import * as React from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Monitor, RefreshCw, Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DesktopPlayerList } from '@/components/desktop-player-list'
import { ErrorBanner } from '@/components/error-banner'
import { LiveSyncBadge } from '@/components/live-sync-badge'
import { ResponsivePagination } from '@/components/responsive-pagination'
import { useLiveSync } from '@/hooks/use-live-sync'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import {
  DESKTOP_PLAYERS_PER_PAGE,
  type DesktopPlayerCounts,
  type DesktopPlayerRow,
  type DesktopPlayersParams,
  type DesktopPlayersResult,
  type PrintFilter,
} from '@/lib/desktop-players'

const FILTERS: Array<{ key: PrintFilter; label: string }> = [
  { key: 'all', label: 'All players' },
  { key: 'on', label: 'Print ON' },
  { key: 'off', label: 'Print OFF' },
]

/**
 * Desktop Player tab, for the superadmin and for agents: players with their
 * Print state. Which players, and where the arrow goes, come from the page.
 * Without setPrint the screen is view only. Search, filter and paging run on the
 * server through one bundled action, polled at the 'normal' tier because Print
 * changes are rare and the list is a directory, not live gameplay.
 */
export function DesktopPlayersScreen({ fetchPlayers, historyHref, setPrint, showAgent = true }: {
  fetchPlayers: (params: DesktopPlayersParams) => Promise<DesktopPlayersResult>
  historyHref: (player: DesktopPlayerRow) => string | null
  setPrint?: (playerId: string, username: string, enabled: boolean) => Promise<{ error: string | null }>
  showAgent?: boolean
}) {
  const [rows, setRows] = React.useState<DesktopPlayerRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [counts, setCounts] = React.useState<DesktopPlayerCounts>({ all: 0, on: 0, off: 0 })
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  const [searchText, setSearchText] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [filter, setFilter] = React.useState<PrintFilter>('all')
  const [page, setPage] = React.useState(1)

  const [confirming, setConfirming] = React.useState<DesktopPlayerRow | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / DESKTOP_PLAYERS_PER_PAGE))

  const request = useRequestGeneration()
  // Returned so useLiveSync can skip a poll tick while this one is in flight.
  const load = React.useCallback(() => {
    const token = request.nextGeneration()
    return fetchPlayers({ search, filter, page }).then(res => {
      if (!request.isCurrent(token)) return
      setIsLoading(false)
      setIsRefreshing(false)
      setLoadError(res.error)
      if (res.error) return
      setRows(res.rows)
      setTotal(res.total)
      setCounts(res.counts)
      // Players can leave the filter between polls, emptying the last page.
      const lastPage = Math.max(1, Math.ceil(res.total / DESKTOP_PLAYERS_PER_PAGE))
      if (page > lastPage) setPage(lastPage)
    }).catch(e => {
      if (!request.isCurrent(token)) return
      setIsLoading(false)
      setIsRefreshing(false)
      setLoadError(e instanceof Error ? e.message : 'Could not load players.')
    })
  }, [request, fetchPlayers, search, filter, page])

  // print_players is not a Realtime table, so a Print change arrives by the
  // 10-second poll; profiles brings balance and block changes sooner.
  const { lastSyncedAt, tierMs, refresh } = useLiveSync(['profiles'], load, 'normal')

  // A new search, filter or page must load at once: useLiveSync's refresh()
  // would be skipped while a poll is in flight, and wait for the next tick. The
  // first render is left to useLiveSync's own fetch on mount.
  const firstRender = React.useRef(true)
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    void load()
  }, [load])

  // Waits for typing to pause, so each letter is not a server request.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchText])

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    refresh()
  }

  const chooseFilter = (next: PrintFilter) => {
    setFilter(next)
    setPage(1)
  }

  const applySwitch = async (player: DesktopPlayerRow, enabled: boolean) => {
    if (!setPrint) return
    setBusyId(player.id)
    setNotice(null)
    const res = await setPrint(player.id, player.username, enabled)
    setBusyId(null)
    if (res.error) {
      setNotice({ ok: false, text: res.error })
      return
    }
    setNotice({
      ok: true,
      text: `Print is ${enabled ? 'ON' : 'OFF'} for @${player.username}, from each game's next round.`,
    })
    // load() also drops any read that started before the change, so an older
    // answer can not put the old state back on screen.
    setRows(current => current.map(row => (row.id === player.id ? { ...row, print_enabled: enabled } : row)))
    void load()
  }

  const handleToggle = (player: DesktopPlayerRow) => {
    if (player.print_enabled) void applySwitch(player, false)
    else setConfirming(player)
  }

  const confirmOn = () => {
    if (!confirming) return
    const player = confirming
    setConfirming(null)
    void applySwitch(player, true)
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Monitor className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground">Desktop Player</h1>
            <p className="text-[11px] text-muted-foreground">Print players play from the Windows app only.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LiveSyncBadge lastSyncedAt={lastSyncedAt} tierMs={tierMs} />
          <Button
            variant="outline"
            size="icon"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            aria-label="Refresh"
            className="h-9 w-9 cursor-pointer rounded-xl"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3" role="group" aria-label="Filter by Print">
        {FILTERS.map(item => {
          const active = filter === item.key
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => chooseFilter(item.key)}
              className={`rounded-xl border p-2.5 sm:p-3 text-left transition-colors cursor-pointer ${
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border/80 bg-card hover:bg-secondary/40'
              }`}
            >
              <span className={`block text-[10px] sm:text-[11px] font-black uppercase tracking-wider ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                {item.label}
              </span>
              <span className="mt-0.5 block font-mono text-xl sm:text-2xl font-black text-foreground">
                {counts[item.key]}
              </span>
            </button>
          )
        })}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Search name, username or ID"
          aria-label="Search players"
          className="h-10 rounded-xl pl-9 text-sm"
        />
      </div>

      <ErrorBanner error={loadError} />

      {notice && (
        <div
          role="status"
          className={`sticky top-0 z-10 flex items-start gap-2 rounded-lg border p-2.5 text-xs font-bold ${
            notice.ok
              ? 'border-emerald-500/20 bg-success-bg text-success-text'
              : 'border-red-500/20 bg-danger-bg text-danger-text'
          }`}
        >
          {notice.ok
            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            : <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />}
          <span>{notice.text}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-border/80 bg-card py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border/80 bg-card py-16 text-center text-sm font-bold text-muted-foreground">
          {search
            ? 'No player matches this search.'
            : filter === 'on'
              ? 'No player has Print on yet.'
              : 'No players here.'}
        </div>
      ) : (
        <DesktopPlayerList
          players={rows}
          busyId={busyId}
          historyHref={historyHref}
          onToggle={setPrint ? handleToggle : undefined}
          showAgent={showAgent}
        />
      )}

      {totalPages > 1 && (
        <ResponsivePagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={total}
          itemsPerPage={DESKTOP_PLAYERS_PER_PAGE}
        />
      )}

      <Dialog open={confirming !== null} onOpenChange={open => { if (!open) setConfirming(null) }}>
        <DialogContent className="sm:max-w-[430px] rounded-2xl border-border/80 bg-card text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-black">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
              Turn Print on for @{confirming?.username}?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              From each game&apos;s next round, this player can only bet from the Windows app, with printed tickets.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-4 text-xs font-semibold text-foreground">
            <li>Normal bets from a phone stop in all 4 games.</li>
            <li>A bet already placed in the current round stays as it is.</li>
            <li>Print can not be changed again for 103 seconds.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} className="cursor-pointer rounded-xl">
              Cancel
            </Button>
            <Button onClick={confirmOn} className="cursor-pointer rounded-xl font-extrabold">
              Turn Print ON
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
