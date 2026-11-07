'use client'

import * as React from 'react'
import type { DateRange as PickedRange } from 'react-day-picker'
import { Card } from '@/components/ui/card'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ErrorBanner } from '@/components/error-banner'
import { Gamepad2, Calendar as CalendarIcon, Layers } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { pickedDayKey } from '@/lib/date-range'
import { useLiveSync } from '@/hooks/use-live-sync'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import { getGameplayStatsAction } from '@/app/superadmin/actions'
import {
  GAMES, EMPTY_MONEY_BY_GAME, combineGames, houseResult, formatSplitValue,
  type GameKey, type GameMoney, type MoneyByGame, type SplitKind,
} from '@/lib/money-totals-logic'
import {
  GAMEPLAY_PRESETS, presetRange, rangeLabel,
  type DayRange, type GameplayPreset,
} from '@/lib/gameplay-range'

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
  const [preset, setPreset] = React.useState<GameplayPreset | null>('today')
  const [custom, setCustom] = React.useState<DayRange | null>(null)
  const [picked, setPicked] = React.useState<PickedRange | undefined>(undefined)
  const [calendarOpen, setCalendarOpen] = React.useState(false)
  // Clicks since the calendar opened. react-day-picker's range mode already
  // reports a complete one-day range on the FIRST click, so the range is only
  // applied on the second click (or on closing after one click = that day).
  const calendarClicks = React.useRef(0)
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

  const choosePreset = (p: GameplayPreset) => {
    if (p === preset) return
    setLoading(true)
    setPreset(p)
    setCustom(null)
    setPicked(undefined)
  }

  const applyPicked = (r: PickedRange | undefined) => {
    if (!r?.from) return
    const from = pickedDayKey(r.from)
    const to = pickedDayKey(r.to ?? r.from)
    setLoading(true)
    setCustom(from <= to ? { from, to } : { from: to, to: from })
    setPreset(null)
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
        <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
          <Layers className="h-3 w-3" /> All games
        </TabButton>
        {GAMES.map((g) => (
          <TabButton key={g.key} active={tab === g.key} onClick={() => setTab(g.key)}>
            <span className={`h-2 w-2 rounded-full ${g.dot}`} aria-hidden /> {g.label}
          </TabButton>
        ))}
      </div>

      {/* Date filter: presets + calendar range */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] sm:text-[11px] font-bold overflow-x-auto table-scroll">
          {GAMEPLAY_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => choosePreset(p.value)}
              className={`px-2.5 py-1 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                preset === p.value
                  ? 'bg-primary text-primary-foreground font-black shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Popover
          open={calendarOpen}
          onOpenChange={(open) => {
            setCalendarOpen(open)
            // Every opening starts a fresh pick (an old selection would make the
            // first click edit that range instead of starting a new one).
            if (open) { calendarClicks.current = 0; setPicked(undefined); return }
            // Closing after picking only one day = that single day.
            if (calendarClicks.current === 1 && picked?.from) applyPicked({ from: picked.from, to: picked.from })
          }}
        >
          <PopoverTrigger
            className={`h-8 px-3 text-[11px] font-extrabold border rounded-xl flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-all ${
              preset === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border/80 bg-card hover:bg-secondary/60 text-foreground'
            }`}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {preset === null && custom ? rangeLabel(custom) : 'Pick dates'}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-card border-border" align="end">
            <Calendar
              mode="range"
              selected={picked}
              onSelect={(r, clickedDay) => {
                calendarClicks.current += 1
                if (calendarClicks.current < 2) { setPicked(r); return }
                // Second click: apply. Clicking the start day again can clear the
                // selection; then it means that one day.
                const range = r?.from ? r : { from: clickedDay, to: clickedDay }
                setPicked(range)
                applyPicked(range)
                setCalendarOpen(false)
              }}
              disabled={{ after: new Date() }}
              numberOfMonths={1}
              // Opens on the month of the chosen range's end, else this month.
              defaultMonth={custom && preset === null ? dayKeyToLocalDate(custom.to) : new Date()}
            />
            {/* w-0 min-w-full: the hint wraps to the calendar's width instead of widening the popover. */}
            <p className="w-0 min-w-full px-3 pb-2 text-[10px] leading-snug text-muted-foreground">Click a start day, then an end day (India time). One day: click it twice.</p>
          </PopoverContent>
        </Popover>
      </div>

      <ErrorBanner error={error} />

      {/* The four figures: 2x2 on a phone, one row from the large breakpoint */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <Tile label="Bets Placed" hint="One player in one round" loading={loading}
          value={<>{figures.bets.toLocaleString('en-IN')} <span className="text-[10px] sm:text-xs text-muted-foreground font-semibold">plays</span></>}
          split={tab === 'all' ? <GameSplit games={games} pick={(m) => m.bets} kind="count" /> : null} />
        <Tile label="Coins Bet" hint="Wagered by players" loading={loading}
          value={formatCurrency(figures.stake)}
          split={tab === 'all' ? <GameSplit games={games} pick={(m) => m.stake} kind="money" /> : null} />
        <Tile label="Coins Won" hint="Paid to winners" loading={loading} valueClass="text-amber-500"
          value={formatCurrency(figures.payout)}
          split={tab === 'all' ? <GameSplit games={games} pick={(m) => m.payout} kind="money" /> : null} />
        <Tile label="Net (House P/L)" hint="Bet minus won" loading={loading}
          valueClass={net >= 0 ? 'text-emerald-500' : 'text-red-500'}
          value={`${net >= 0 ? '+' : ''}${formatCurrency(net)}`}
          split={tab === 'all' ? <GameSplit games={games} pick={(m) => houseResult(m)} kind="signed" /> : null} />
      </div>
    </Card>
  )
}

/** 'YYYY-MM-DD' as a local-midnight Date, the form the Calendar widget uses for a day. */
function dayKeyToLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
        active
          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
          : 'bg-secondary/30 border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/60'
      }`}
    >
      {children}
    </button>
  )
}

function Tile({ label, hint, value, valueClass = 'text-foreground', loading, split }: {
  label: string
  hint: string
  value: React.ReactNode
  valueClass?: string
  loading: boolean
  split: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-secondary/20 p-2.5 sm:p-3 space-y-1 min-w-0">
      <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground block truncate">{label}</span>
      {loading ? (
        <div className="h-6 sm:h-7 w-20 bg-secondary/80 animate-pulse rounded" />
      ) : (
        <div className={`text-base sm:text-2xl font-black font-mono truncate ${valueClass}`}>{value}</div>
      )}
      {!loading && split}
      <p className="text-[9px] text-muted-foreground/70 truncate">{hint}</p>
    </div>
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
