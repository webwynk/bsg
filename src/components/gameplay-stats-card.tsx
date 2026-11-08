'use client'

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { RangeFilter, PillTab, StatTile, type RangeChoice } from '@/components/range-filter'
import { ErrorBanner } from '@/components/error-banner'
import { Gamepad2, Layers } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { useLiveSync } from '@/hooks/use-live-sync'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import { getGameplayStatsAction } from '@/app/superadmin/actions'
import {
  GAMES, EMPTY_MONEY_BY_GAME, combineGames, houseResult, formatSplitValue,
  type GameKey, type GameMoney, type MoneyByGame, type SplitKind,
} from '@/lib/money-totals-logic'
import { presetRange, rangeLabel, type DayRange, type GameplayPreset } from '@/lib/gameplay-range'

type Tab = 'all' | GameKey
type Loader = (range: DayRange | null) => Promise<{ games: MoneyByGame; error: string | null }>

/**
 * Superadmin dashboard "Gameplay & Bets Audit" card (2026-11-07).
 *
 * Tabs: "All games" (default) + one tab per entry in GAMES
 * (lib/money-totals-logic.ts), so a new game in that list gets its own tab
 * with no change here. Filter: Today (default) / Yesterday / 7 days / 30 days /
 * Lifetime, or any range of IST days picked on the calendar. Four figures per
 * tab: Bets Placed (one player in one round), Coins Bet, Coins Won and Net
 * (House P/L = bet minus won; green when the house is up). The All tab also
 * shows each game's share under every figure.
 *
 * Data: one getGameplayStatsAction call per range returns every game at once,
 * so switching tabs never waits for the server. Kept fresh like the rest of
 * the page: Realtime on bets/coin_ledger plus the 10 s 'normal' poll
 * (useLiveSync). `loadStats` exists only so the card can be rendered with
 * sample data; the dashboard always uses the server action.
 */
export function GameplayStatsCard({ loadStats = getGameplayStatsAction }: { loadStats?: Loader }) {
  const [tab, setTab] = React.useState<Tab>('all')
  const [choice, setChoice] = React.useState<RangeChoice>({ preset: 'today', custom: null })
  const { preset, custom } = choice
  const [games, setGames] = React.useState<MoneyByGame>(EMPTY_MONEY_BY_GAME)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const request = useRequestGeneration()

  // The filter in force, read by load() (also on the live poll). Updated in the
  // effect below when the filter changes. A preset is counted from "now" on
  // every load, so "Today" rolls over at IST midnight without a reload.
  const filterRef = React.useRef<{ preset: GameplayPreset | null; custom: DayRange | null }>({ preset: 'today', custom: null })

  const load = React.useCallback(() => {
    const token = request.nextGeneration()
    const f = filterRef.current
    const range = f.preset ? presetRange(f.preset, new Date()) : f.custom
    return loadStats(range).then((res) => {
      if (!request.isCurrent(token)) return
      setLoading(false)
      setError(res.error)
      if (!res.error) setGames(res.games)
    }).catch((e) => {
      if (!request.isCurrent(token)) return
      setLoading(false)
      setError(e instanceof Error ? e.message : 'Could not load gameplay figures.')
    })
  }, [loadStats, request])

  const { refresh } = useLiveSync(['bets', 'coin_ledger'], load, 'normal')

  // A new filter: hand it to load(), then load straight away.
  React.useEffect(() => {
    const prev = filterRef.current
    if (prev.preset === preset && prev.custom?.from === custom?.from && prev.custom?.to === custom?.to) return
    filterRef.current = { preset, custom }
    refresh()
  }, [preset, custom, refresh])

  const chooseRange = (next: RangeChoice) => {
    setLoading(true)
    setChoice(next)
  }

  const shownRange = preset ? presetRange(preset, new Date()) : custom
  const figures: GameMoney = tab === 'all' ? combineGames(games) : games[tab]
  const net = houseResult(figures)
  const activeGame = GAMES.find((g) => g.key === tab)

  return (
    <Card className="bg-card border-border/80 shadow-2xs rounded-2xl p-3 sm:p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
            <Gamepad2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-black tracking-tight text-foreground leading-tight truncate">
              Gameplay &amp; Bets Audit
            </h2>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground font-semibold truncate">
              {activeGame ? activeGame.label : 'All games'} · {rangeLabel(shownRange)}{shownRange ? ' (IST)' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Game tabs: All + one per game in GAMES (scrolls sideways on a phone) */}
      <div role="tablist" aria-label="Game" className="flex items-center gap-1.5 overflow-x-auto table-scroll pb-1 -mx-0.5 px-0.5">
        <PillTab active={tab === 'all'} onClick={() => setTab('all')}>
          <Layers className="h-3 w-3" /> All games
        </PillTab>
        {GAMES.map((g) => (
          <PillTab key={g.key} active={tab === g.key} onClick={() => setTab(g.key)}>
            <span className={`h-2 w-2 rounded-full ${g.dot}`} aria-hidden /> {g.label}
          </PillTab>
        ))}
      </div>

      {/* Date filter: presets + calendar range (shared with the Player History page) */}
      <RangeFilter value={choice} onChange={chooseRange} />

      <ErrorBanner error={error} />

      {/* The four figures: 2x2 on a phone, one row from the large breakpoint */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatTile label="Bets Placed" hint="One player in one round" loading={loading}
          value={<>{figures.bets.toLocaleString('en-IN')} <span className="text-[10px] sm:text-xs text-muted-foreground font-semibold">plays</span></>}
          extra={tab === 'all' ? <GameSplit games={games} pick={(m) => m.bets} kind="count" /> : null} />
        <StatTile label="Coins Bet" hint="Wagered by players" loading={loading}
          value={formatCurrency(figures.stake)}
          extra={tab === 'all' ? <GameSplit games={games} pick={(m) => m.stake} kind="money" /> : null} />
        <StatTile label="Coins Won" hint="Paid to winners" loading={loading} valueClass="text-amber-500"
          value={formatCurrency(figures.payout)}
          extra={tab === 'all' ? <GameSplit games={games} pick={(m) => m.payout} kind="money" /> : null} />
        <StatTile label="Net (House P/L)" hint="Bet minus won" loading={loading}
          valueClass={net >= 0 ? 'text-emerald-500' : 'text-red-500'}
          value={`${net >= 0 ? '+' : ''}${formatCurrency(net)}`}
          extra={tab === 'all' ? <GameSplit games={games} pick={(m) => houseResult(m)} kind="signed" /> : null} />
      </div>
    </Card>
  )
}

/** Each game's share of a figure, one line per game in GAMES (All tab only). */
function GameSplit({ games, pick, kind }: { games: MoneyByGame; pick: (m: GameMoney) => number; kind: SplitKind }) {
  return (
    <div className="flex flex-col gap-0.5 text-[9px] sm:text-[10px] font-mono font-semibold leading-tight text-muted-foreground/80" aria-label="Split by game">
      {GAMES.map((g) => (
        <span key={g.key} className="flex items-center gap-1 min-w-0">
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${g.dot}`} aria-hidden />
          <span className="truncate">{g.label}</span>
          <span className="ml-auto pl-1 text-foreground/80">{formatSplitValue(pick(games[g.key]), kind)}</span>
        </span>
      ))}
    </div>
  )
}
