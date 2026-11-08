'use client'

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { ResponsivePagination } from '@/components/responsive-pagination'
import { ErrorBanner } from '@/components/error-banner'
import { RangeFilter, PillTab, StatTile, type RangeChoice } from '@/components/range-filter'
import { TripleChancePlayList } from '@/components/triple-chance-play-list'
import { LuckyCardPlayList } from '@/components/lucky-card-player-history'
import { Spin2WinPlayList } from '@/components/spin2win-player-history'
import { Lucky16PlayList } from '@/components/lucky16-player-history'
import { useLiveSync } from '@/hooks/use-live-sync'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import type { LiveTable } from '@/components/live-data-provider'
import { formatCurrency } from '@/lib/utils'
import { GAMES, EMPTY_MONEY_BY_GAME, houseResult, type GameKey, type MoneyByGame } from '@/lib/money-totals-logic'
import { presetRange, rangeLabel, type DayRange } from '@/lib/gameplay-range'
import { HISTORY_OUTCOMES, HISTORY_PAGE_SIZE, parseRoundSearch, type HistoryOutcome } from '@/lib/player-history-filter'
import { getPlayerGamePlaysAction, getPlayerGameStatsAction } from '@/app/agent/players/player-game-history-actions'
import type { PlayerHistoryPlay } from '@/app/agent/players/player-game-history'

/** Live signals: any game's rounds moving (a draw or a settle) or the coin ledger. */
const LIVE_TABLES: LiveTable[] = ['rounds', 'lucky_card_rounds', 'spin2win_rounds', 'lucky16_rounds', 'coin_ledger']

/**
 * Player History: the "Game Plays" side of a player's page, the same on the
 * superadmin agent page and the agent players page (2026-11-07 redesign):
 *
 *  1. Game tabs, one per entry in GAMES (Triple Chance first).
 *  2. One date filter (Today default / Yesterday / 7 days / 30 days / Lifetime /
 *     a calendar range of IST days) for BOTH the tiles and the list.
 *  3. Four tiles for that game and range: Total Plays (rounds played -- phone
 *     bets and Print tickets in one round = 1), Bet Volume, Win Payout and Net
 *     House (bet minus won; green when the house is up). Added up by the
 *     database, so nothing is capped (the old page summed the last 100 plays).
 *  4. All / Won / Lost and a round-ID search, then the paged list (newest
 *     first) with the same rows, detail popups and PDFs as before.
 *
 * Data: getPlayerGameStatsAction (all games at once, per range) and
 * getPlayerGamePlaysAction (one page of the open game). Kept fresh by
 * useLiveSync ('fast': realtime on the games' rounds and coin_ledger, plus a
 * 3-second poll), like the lists it replaces.
 */
type Loaders = {
  stats: typeof getPlayerGameStatsAction
  plays: typeof getPlayerGamePlaysAction
}
const SERVER_LOADERS: Loaders = { stats: getPlayerGameStatsAction, plays: getPlayerGamePlaysAction }

export function PlayerGameHistory({
  playerIdentifier,
  playerFullName,
  playerUsername,
  loaders = SERVER_LOADERS,
}: {
  /** The player's id. */
  playerIdentifier: string
  playerFullName: string
  playerUsername: string
  /** Only so the component can be rendered with sample data; pages always use the server actions. */
  loaders?: Loaders
}) {
  const [game, setGame] = React.useState<GameKey>(GAMES[0].key)
  const [choice, setChoice] = React.useState<RangeChoice>({ preset: 'today', custom: null })
  const [outcome, setOutcome] = React.useState<HistoryOutcome>('all')
  const [searchText, setSearchText] = React.useState('')
  const [roundSearch, setRoundSearch] = React.useState('') // applied search
  const [page, setPage] = React.useState(1)

  const [stats, setStats] = React.useState<{ key: string; games: MoneyByGame } | null>(null)
  const [list, setList] = React.useState<{ key: string; plays: PlayerHistoryPlay[]; total: number } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const statsRequest = useRequestGeneration()
  const listRequest = useRequestGeneration()

  // What each answer belongs to: the tiles to (player, range); the list to
  // (player, game, range, outcome, search, page). An answer for anything else
  // is not shown, so switching shows skeletons instead of the wrong numbers.
  const rangeKey = `${choice.preset}|${choice.custom?.from}|${choice.custom?.to}`
  const statsKey = `${playerIdentifier}|${rangeKey}`
  const listKey = `${statsKey}|${game}|${outcome}|${roundSearch}|${page}`

  // The filter in force, read by the loaders (also on every live tick). A preset
  // is worked out from "now" on each load, so "Today" rolls over at IST midnight.
  const current = React.useRef({ playerIdentifier, game, choice, outcome, roundSearch, page, statsKey, listKey })
  React.useEffect(() => {
    current.current = { playerIdentifier, game, choice, outcome, roundSearch, page, statsKey, listKey }
  })

  const load = React.useCallback(() => {
    const f = current.current
    const range: DayRange | null = f.choice.preset ? presetRange(f.choice.preset, new Date()) : f.choice.custom
    const sToken = statsRequest.nextGeneration()
    const lToken = listRequest.nextGeneration()
    const statsP = loaders.stats(f.playerIdentifier, range).then((res) => {
      if (!statsRequest.isCurrent(sToken)) return
      if (res.error) setError(res.error)
      else setStats({ key: f.statsKey, games: res.games })
    })
    const listP = loaders.plays(f.playerIdentifier, f.game, { range, outcome: f.outcome, roundSearch: f.roundSearch, page: f.page }).then((res) => {
      if (!listRequest.isCurrent(lToken)) return
      if (res.error) setError(res.error)
      else { setList({ key: f.listKey, plays: res.plays, total: res.total }); setError(null) }
    })
    return Promise.all([statsP, listP]).catch((e) => setError(e instanceof Error ? e.message : 'Could not load the history.'))
  }, [statsRequest, listRequest, loaders])

  const { refresh } = useLiveSync(LIVE_TABLES, load, 'fast')

  // Any change of player or filter: load at once (useLiveSync covers the first
  // load and the live ticks).
  const lastLoaded = React.useRef(listKey)
  React.useEffect(() => {
    if (lastLoaded.current === listKey) return
    lastLoaded.current = listKey
    refresh()
  }, [listKey, refresh])

  const changeFilter = (fn: () => void) => { fn(); setPage(1) }
  const searchProblem = parseRoundSearch(searchText) === 'invalid'
  const applySearch = () => { if (!searchProblem) changeFilter(() => setRoundSearch(searchText.trim())) }
  const clearSearch = () => { setSearchText(''); changeFilter(() => setRoundSearch('')) }

  const statsReady = stats !== null && stats.key === statsKey
  const listReady = list !== null && list.key === listKey
  const figures = (statsReady ? stats.games : EMPTY_MONEY_BY_GAME)[game]
  const net = houseResult(figures)
  const shownRange = choice.preset ? presetRange(choice.preset, new Date()) : choice.custom
  const gameLabel = GAMES.find((g) => g.key === game)?.label ?? ''
  const totalPages = listReady ? Math.max(1, Math.ceil(list.total / HISTORY_PAGE_SIZE)) : 1

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* 1. Game tabs (scroll sideways on a phone) */}
      <div role="tablist" aria-label="Game" className="flex items-center gap-1.5 overflow-x-auto table-scroll pb-1 -mx-0.5 px-0.5">
        {GAMES.map((g) => (
          <PillTab key={g.key} active={game === g.key} onClick={() => changeFilter(() => setGame(g.key))}>
            <span className={`h-2 w-2 rounded-full ${g.dot}`} aria-hidden /> {g.label}
          </PillTab>
        ))}
      </div>

      {/* 2. One date filter for the tiles and the list */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
        <RangeFilter value={choice} onChange={(next) => changeFilter(() => setChoice(next))} />
        <p className="text-[10px] sm:text-[11px] text-muted-foreground font-semibold">
          {gameLabel} · {rangeLabel(shownRange)}{shownRange ? ' (IST)' : ''}
        </p>
      </div>

      <ErrorBanner error={error} />

      {/* 3. The game's four figures: 2x2 on a phone, one row from the small breakpoint */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile label="Total Plays" hint="Rounds played" loading={!statsReady}
          value={figures.bets.toLocaleString('en-IN')} />
        <StatTile label="Bet Volume" hint="Coins bet" loading={!statsReady}
          value={formatCurrency(figures.stake)} />
        <StatTile label="Win Payout" hint="Coins won" loading={!statsReady} valueClass="text-amber-500"
          value={formatCurrency(figures.payout)} />
        <StatTile label="Net House" hint="Bet minus won" loading={!statsReady}
          valueClass={net >= 0 ? 'text-emerald-500' : 'text-red-500'}
          value={`${net >= 0 ? '+' : ''}${formatCurrency(net)}`} />
      </div>

      {/* 4. List filters: All / Won / Lost and round-ID search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] sm:text-[11px] font-bold self-start">
          {HISTORY_OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => changeFilter(() => setOutcome(o.value))}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                outcome === o.value ? 'bg-primary text-primary-foreground font-black shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-1.5 w-full sm:w-auto"
          onSubmit={(e) => { e.preventDefault(); applySearch() }}
          role="search"
        >
          <div className={`flex items-center flex-1 sm:w-56 h-8 rounded-xl border bg-card px-2 gap-1.5 ${searchProblem ? 'border-red-500/60' : 'border-border/80'}`}>
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Round ID, e.g. TC-17418073"
              aria-label="Search by round ID"
              inputMode="text"
              className="flex-1 min-w-0 bg-transparent text-[11px] font-mono text-foreground placeholder:text-muted-foreground/70 outline-none"
            />
            {(searchText || roundSearch) && (
              <button type="button" onClick={clearSearch} aria-label="Clear search" className="text-muted-foreground hover:text-foreground cursor-pointer">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button type="submit" disabled={searchProblem} className="h-8 px-3 rounded-xl bg-primary text-primary-foreground text-[11px] font-black cursor-pointer disabled:opacity-50 shrink-0">
            Search
          </button>
        </form>
      </div>
      {searchProblem && <p className="text-[10px] text-red-400 -mt-1">Type a round ID like TC-17418073 or just the number.</p>}

      {/* The list */}
      <Card className="border-border/80 bg-card rounded-xl overflow-hidden shadow-xs">
        {!listReady ? (
          <div className="p-4 space-y-2.5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-secondary/20 animate-pulse border border-border/40">
                <div className="h-3.5 bg-secondary/80 rounded w-1/4" />
                <div className="h-3.5 bg-secondary/60 rounded w-1/3" />
                <div className="h-3.5 bg-secondary/70 rounded w-1/6" />
              </div>
            ))}
          </div>
        ) : list.plays.length === 0 ? (
          <div className="p-10 text-center text-xs text-muted-foreground font-medium">
            {roundSearch ? `No ${gameLabel} play in round ${roundSearch} for this filter.` : `No ${gameLabel} plays for this filter.`}
          </div>
        ) : (
          <>
            <PlayRows rows={list.plays} playerIdentifier={playerIdentifier} playerFullName={playerFullName} playerUsername={playerUsername} />
            {list.total > HISTORY_PAGE_SIZE && (
              <div className="p-3 border-t border-border/60">
                <ResponsivePagination
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  totalItems={list.total}
                  itemsPerPage={HISTORY_PAGE_SIZE}
                />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

/** Draws one page of plays with the open game's own rows (all rows are the same game). */
function PlayRows({ rows, playerIdentifier, playerFullName, playerUsername }: {
  rows: PlayerHistoryPlay[]
  playerIdentifier: string
  playerFullName: string
  playerUsername: string
}) {
  const who = { playerIdentifier, playerFullName, playerUsername }
  const first = rows[0]
  switch (first.game) {
    case 'triple_chance':
      return <TripleChancePlayList {...who} plays={rows.flatMap((r) => (r.game === 'triple_chance' ? [r.play] : []))} />
    case 'lucky_card':
      return <LuckyCardPlayList {...who} plays={rows.flatMap((r) => (r.game === 'lucky_card' ? [r.play] : []))} />
    case 'spin2win':
      return <Spin2WinPlayList {...who} plays={rows.flatMap((r) => (r.game === 'spin2win' ? [r.play] : []))} />
    case 'lucky16':
      return <Lucky16PlayList {...who} plays={rows.flatMap((r) => (r.game === 'lucky16' ? [r.play] : []))} />
  }
}
