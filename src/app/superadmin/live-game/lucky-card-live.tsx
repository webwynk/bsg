"use client"

import { useState, useEffect, useCallback } from 'react'
import { useLiveSync } from '@/hooks/use-live-sync'
import type { LiveTable } from '@/components/live-data-provider'
import { LiveSyncBadge } from '@/components/live-sync-badge'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import { formatCurrency } from '@/lib/utils'
import { ErrorBanner } from '@/components/error-banner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  RefreshCw,
  Clock,
  Loader2,
  Sparkles,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  History,
  Settings2,
  Percent,
  Check,
  Layers,
} from 'lucide-react'
import {
  getLuckyCardLiveAction,
  updateLuckyCardRtpAction,
  updateLuckyCardNextBonusAction,
  applyLuckyCardBonusToCurrentRoundAction,
  getLuckyCardRoundPlayersAction,
  type LuckyCardLiveData,
  type LuckyCardPlayersResult,
} from './lucky-card-actions'
import {
  LC_BONUS_MAX,
  LC_BONUS_MIN,
  bonusLabel,
  bonusLabelLong,
  paginate,
  relativeTime,
  suitIsRed,
  suitSymbol,
  type LcRank,
  type LcSuit,
} from '@/lib/lucky-card'
import {
  LC_RTP_MAX,
  LC_RTP_MIN,
  LC_RTP_PRESETS,
  LC_RTP_STEP,
  bonusHeadline,
  configLockMessage,
  currentSecondsInto,
  filterDraws,
  isBoostLocked,
  isConfigLocked,
  rtpEdge,
  rtpRating,
  secondsUntilDraw,
  type DrawStatusFilter,
  type LuckyCardDraw,
  type RtpTone,
} from './lucky-card-live-logic'

/**
 * Lucky Card tab of the Live Game page (spec 13.1, 17AN to 17AQ). Everything
 * the superadmin needs for the game in one place: its own RTP (30 to 100), its
 * own bonus (this round and next round, 1 to 10), the round in progress, the
 * recent draws and the draw ledger. Separate from Triple Chance's settings,
 * which live in another table and are never touched from here.
 *
 * One load every 3 seconds (getLuckyCardLiveAction) plus an instant reload when
 * the shared live connection reports a change of lucky_card_rounds, through
 * useLiveSync -- the same mechanism Triple Chance's tab uses. Between loads the
 * screen counts the round's seconds itself (currentSecondsInto), so the locks
 * and the countdown move smoothly without a second poll.
 */

const LIVE_TABLES: LiveTable[] = ['lucky_card_rounds']
const ITEMS_PER_PAGE = 8

const RTP_TONE_CLASS: Record<RtpTone, string> = {
  aggressive: 'text-amber-500',
  balanced: 'text-success-text',
  friendly: 'text-blue-400',
  full: 'text-emerald-400',
}

const BONUS_VALUES = Array.from({ length: LC_BONUS_MAX - LC_BONUS_MIN + 1 }, (_, i) => LC_BONUS_MIN + i)

/** "Coins" unit label, kept local like the Triple Chance page's. */
function CoinsSuffix() {
  return <span className="text-[9px] font-normal text-muted-foreground/60 ml-0.5">Coins</span>
}

/** A playing card as text: the rank and the suit symbol, red suits in red. */
function CardFace({ rank, suit, className = '' }: { rank: LcRank; suit: LcSuit; className?: string }) {
  return (
    <span className={`font-black ${suitIsRed(suit) ? 'text-red-400' : 'text-foreground'} ${className}`}>
      {rank}{suitSymbol(suit)}
    </span>
  )
}

/** The 1 to 10 button row used by both bonus controls. */
function BonusButtons({
  selected, disabled, onPick, label,
}: {
  selected: number | null
  disabled: boolean
  onPick: (value: number) => void
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-5 sm:grid-cols-10 gap-0.5 bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] font-bold"
    >
      {BONUS_VALUES.map(value => (
        <button
          key={value}
          type="button"
          aria-pressed={selected === value}
          onClick={() => onPick(value)}
          disabled={disabled}
          className={`px-1.5 py-1.5 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            selected === value
              ? 'bg-primary text-primary-foreground font-black shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {bonusLabel(value)}
        </button>
      ))}
    </div>
  )
}

function BonusBadge({ bonus }: { bonus: number }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
      bonus === 1
        ? 'text-muted-foreground bg-secondary/40 border border-border/60'
        : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
    }`}>
      {bonusLabel(bonus)}
    </span>
  )
}

function Money({ amount, plus = false }: { amount: number; plus?: boolean }) {
  return <>{plus && amount > 0 ? '+' : ''}{formatCurrency(amount)}<CoinsSuffix /></>
}

/** A short success or error line under a control; nothing when there is no message. */
function MessageLine({ message }: { message: { text: string; isError: boolean } | null }) {
  if (!message) return null
  return (
    <div className={`p-2 text-xs font-bold rounded-lg border flex items-center space-x-1.5 ${
      message.isError
        ? 'bg-danger-bg text-danger-text border-red-500/20'
        : 'bg-success-bg text-success-text border-emerald-500/20'
    }`}>
      {!message.isError && <Check className="h-3.5 w-3.5 shrink-0" />}
      <span>{message.text}</span>
    </div>
  )
}

type PlayersState =
  | { status: 'loading' }
  | { status: 'ready'; result: LuckyCardPlayersResult }

function istTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short',
  })
}

export function LuckyCardLive() {
  const [data, setData] = useState<LuckyCardLiveData | null>(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  // Same pattern as the Triple Chance page: Date.now() cannot be read while
  // rendering, so the clock starts at 0 and its ticker sets the real value.
  const [nowTime, setNowTime] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // The RTP the admin is dragging toward; null = show what the server has.
  // A 3-second reload therefore never snaps the slider back mid-drag.
  const [rtpDraft, setRtpDraft] = useState<number | null>(null)
  const [isSavingRtp, setIsSavingRtp] = useState(false)
  const [rtpMessage, setRtpMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const [isSavingNextBonus, setIsSavingNextBonus] = useState(false)
  const [nextBonusMessage, setNextBonusMessage] = useState<{ text: string; isError: boolean } | null>(null)
  const [isSavingThisRound, setIsSavingThisRound] = useState(false)
  const [thisRoundMessage, setThisRoundMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<DrawStatusFilter>('ALL')
  const [currentPage, setCurrentPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [playersByRound, setPlayersByRound] = useState<Record<string, PlayersState>>({})

  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const request = useRequestGeneration()
  // Returned (not fire-and-forget) so useLiveSync can skip a poll tick while
  // this one is still in flight (Issue #93).
  const loadData = useCallback(() => {
    const token = request.nextGeneration()
    return getLuckyCardLiveAction().then(res => {
      if (!request.isCurrent(token)) return
      setIsLoading(false)
      setIsRefreshing(false)
      setLoadError(res.error)
      // A failed load keeps the last good data on screen instead of blanking it.
      if (!res.error) {
        setData(res)
        setFetchedAt(Date.now())
      }
    }).catch((e) => {
      if (!request.isCurrent(token)) return
      setIsLoading(false)
      setIsRefreshing(false)
      console.error('Error loading Lucky Card:', e)
      setLoadError(e instanceof Error ? e.message : 'Could not load Lucky Card.')
    })
  }, [request])

  // refresh() goes through the same in-flight guard as the automatic triggers.
  const { lastSyncedAt, tierMs, refresh } = useLiveSync(LIVE_TABLES, loadData, 'fast')

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    refresh()
  }

  // ---- the clock and the locks -------------------------------------------
  const activeRound = data?.activeRound ?? null
  const secondsInto = currentSecondsInto(activeRound?.secondsInto ?? null, fetchedAt, nowTime)
  const configLocked = isConfigLocked(secondsInto)
  const boostLocked = isBoostLocked(secondsInto, activeRound?.drawn ?? false)
  const untilDraw = secondsInto !== null && activeRound
    ? secondsUntilDraw(secondsInto, activeRound.drawAtSecond)
    : null

  const rtpValue = rtpDraft ?? data?.rtp ?? 90
  const rating = rtpRating(rtpValue)
  const nextBonus = data?.nextBonus ?? 1
  const headline = bonusHeadline(activeRound?.bonus ?? null, nextBonus)

  // ---- actions -------------------------------------------------------------
  const flash = (set: (m: { text: string; isError: boolean } | null) => void, text: string, isError: boolean, ms: number) => {
    set({ text, isError })
    setTimeout(() => set(null), ms)
  }

  const handleApplyRtp = async (target?: number) => {
    const value = target ?? rtpValue
    setIsSavingRtp(true)
    setRtpMessage(null)
    const res = await updateLuckyCardRtpAction(value)
    setIsSavingRtp(false)
    if (res.success) {
      // Show the new value at once; the next load confirms it.
      setData(prev => (prev ? { ...prev, rtp: value } : prev))
      setRtpDraft(null)
      flash(setRtpMessage, `RTP updated to ${value}% — applies from the next round`, false, 2500)
      refresh()
    } else {
      flash(setRtpMessage, res.error ?? 'Could not update RTP.', true, 3500)
    }
  }

  const handleNextBonus = async (value: number) => {
    setIsSavingNextBonus(true)
    setNextBonusMessage(null)
    const res = await updateLuckyCardNextBonusAction(value)
    setIsSavingNextBonus(false)
    if (res.success) {
      setData(prev => (prev ? { ...prev, nextBonus: value } : prev))
      flash(setNextBonusMessage, `Bonus set to ${bonusLabelLong(value)} — applies to the next round`, false, 2500)
      refresh()
    } else {
      flash(setNextBonusMessage, res.error ?? 'Could not update the bonus.', true, 3500)
    }
  }

  const handleThisRound = async (value: number) => {
    setIsSavingThisRound(true)
    setThisRoundMessage(null)
    const res = await applyLuckyCardBonusToCurrentRoundAction(value)
    setIsSavingThisRound(false)
    if (res.success) {
      setData(prev => (prev && prev.activeRound ? { ...prev, activeRound: { ...prev.activeRound, bonus: value } } : prev))
      flash(setThisRoundMessage, `Round #${res.roundNumber} boosted to ${bonusLabelLong(value)} — live now`, false, 3500)
      refresh()
    } else {
      flash(setThisRoundMessage, res.error ?? 'Could not apply the bonus.', true, 3500)
    }
  }

  const toggleDraw = (draw: LuckyCardDraw) => {
    if (draw.playerCount === 0) return
    if (expandedId === draw.roundId) {
      setExpandedId(null)
      return
    }
    setExpandedId(draw.roundId)
    if (playersByRound[draw.roundId]?.status === 'ready') return
    setPlayersByRound(prev => ({ ...prev, [draw.roundId]: { status: 'loading' } }))
    getLuckyCardRoundPlayersAction(draw.roundId)
      .then(result => setPlayersByRound(prev => ({ ...prev, [draw.roundId]: { status: 'ready', result } })))
      .catch(e => setPlayersByRound(prev => ({
        ...prev,
        [draw.roundId]: {
          status: 'ready',
          result: { players: [], total: 0, error: e instanceof Error ? e.message : 'Could not load players.' },
        },
      })))
  }

  // ---- ledger --------------------------------------------------------------
  const draws = data?.draws ?? []
  const filteredDraws = filterDraws(draws, searchQuery, statusFilter)
  const pageInfo = paginate(filteredDraws, currentPage, ITEMS_PER_PAGE)

  const diffSecondsOf = (iso: string) => (nowTime - new Date(iso).getTime()) / 1000
  const previous = draws.length > 0 ? draws[0] : null

  const renderPlayers = (draw: LuckyCardDraw) => {
    const state = playersByRound[draw.roundId]
    if (!state || state.status === 'loading') {
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading players...
        </div>
      )
    }
    if (state.result.error) {
      return <div className="text-xs font-bold text-danger-text p-2">{state.result.error}</div>
    }
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-bold text-primary border-b border-border/40 pb-1.5">
          Participating Players ({state.result.total})
          {state.result.total > state.result.players.length && (
            <span className="text-muted-foreground font-semibold"> — showing the {state.result.players.length} biggest stakes</span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground font-mono break-all">Round id: {draw.roundId}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-sans">
          {state.result.players.map((p, idx) => (
            <div key={idx} className="bg-secondary/40 px-2.5 py-1.5 rounded-lg border border-border/30 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-foreground truncate">@{p.username}</span>
                <div className="flex items-center space-x-2 text-[11px] font-mono shrink-0">
                  <span className="text-muted-foreground">Bet: <Money amount={p.totalStake} /></span>
                  <span className={p.totalPayout > 0 ? 'text-emerald-400 font-extrabold' : 'text-muted-foreground'}>
                    {p.totalPayout > 0 ? <Money amount={p.totalPayout} plus /> : <>0<CoinsSuffix /></>}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {p.cards.map(c => (
                  <span
                    key={c.card}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${
                      c.isWinner
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                        : 'bg-background/60 border-border/50 text-muted-foreground'
                    }`}
                  >
                    {c.card} {formatCurrency(c.amount)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black text-foreground">Lucky Card</h2>
          <LiveSyncBadge lastSyncedAt={lastSyncedAt} tierMs={tierMs} />
        </div>
        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-secondary hover:bg-secondary/80 border border-border text-foreground transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      <ErrorBanner error={loadError} />

      {/* RTP and bonus: Lucky Card's own settings (lucky_card_config), separate
          from Triple Chance's. Pinned onto each round when it is created, so
          the locks are a courtesy and a change is safe at any second. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card border-border/80 shadow-md rounded-2xl p-3.5 sm:p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Settings2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground leading-tight">RTP Configuration</h3>
                <p className={`text-[10px] font-bold ${RTP_TONE_CLASS[rating.tone]}`}>{rating.label}</p>
              </div>
            </div>
            <span className="font-mono font-black text-amber-500 text-lg bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
              {rtpValue}%
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-2 p-2 animate-pulse">
              <div className="h-4 bg-secondary/80 rounded w-full" />
              <div className="h-6 bg-secondary/60 rounded w-full" />
            </div>
          ) : (
            <div className="space-y-2.5">
              <MessageLine message={rtpMessage} />

              {configLocked && (
                <div className="p-1.5 text-[11px] font-bold rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center space-x-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>{configLockMessage(untilDraw, activeRound?.drawn ?? false)}</span>
                </div>
              )}

              <div className="space-y-1">
                <Slider
                  value={[rtpValue]}
                  onValueChange={(val) => {
                    if (typeof val === 'number') setRtpDraft(val)
                    else if (Array.isArray(val) && typeof val[0] === 'number') setRtpDraft(val[0])
                  }}
                  max={LC_RTP_MAX}
                  min={LC_RTP_MIN}
                  step={LC_RTP_STEP}
                  disabled={configLocked}
                  formatValue={(v) => `${v}%`}
                  className="w-full cursor-pointer disabled:opacity-50"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                  <span>{LC_RTP_MIN}%</span>
                  <span>{LC_RTP_MAX}%</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto table-scroll pb-1">
                {LC_RTP_PRESETS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleApplyRtp(val)}
                    disabled={isSavingRtp || configLocked}
                    className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-mono font-black transition-all cursor-pointer border disabled:opacity-50 disabled:cursor-not-allowed ${
                      rtpValue === val
                        ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                        : 'bg-secondary/40 text-muted-foreground border-border/60 hover:text-foreground hover:bg-secondary'
                    }`}
                  >
                    {val}%
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-mono font-bold">
                  <span className="text-emerald-400">Return {rtpValue}%</span>
                  <span className="text-amber-400">Edge {rtpEdge(rtpValue)}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-amber-500/20 overflow-hidden flex">
                  <div className="h-full bg-emerald-500 transition-all duration-300 rounded-l-full" style={{ width: `${rtpValue}%` }} />
                  <div className="h-full bg-amber-500 transition-all duration-300 rounded-r-full" style={{ width: `${rtpEdge(rtpValue)}%` }} />
                </div>
              </div>

              <Button
                onClick={() => handleApplyRtp()}
                disabled={isSavingRtp || configLocked}
                className="w-full h-8 font-extrabold text-xs cursor-pointer bg-primary text-primary-foreground hover:bg-primary/95 rounded-xl shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingRtp ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {isSavingRtp ? 'Saving Configuration...' : configLocked ? 'Locked Until Next Round' : 'Apply Configuration'}
              </Button>
            </div>
          )}
        </Card>

        <Card className="bg-card border-border/80 shadow-md rounded-2xl p-3.5 sm:p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Percent className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground leading-tight">Bonus Multiplier</h3>
                <p className="text-[10px] text-muted-foreground">
                  {headline.liveNow ? 'Live now — this round is boosted.' : 'Promotional payout boost (N, 2X to 10X).'}
                </p>
              </div>
            </div>
            <span className="font-mono font-black text-amber-500 text-lg bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
              {headline.text}
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-3 p-2 animate-pulse">
              <div className="h-8 bg-secondary/60 rounded w-full" />
              <div className="h-8 bg-secondary/60 rounded w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">This Round</span>
                <MessageLine message={thisRoundMessage} />
                {boostLocked && !thisRoundMessage && (
                  <div className="p-2 text-xs font-bold rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center space-x-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>{activeRound?.drawn ? 'This round has already been drawn.' : 'Locked — the draw is close. Try again next round.'}</span>
                  </div>
                )}
                <BonusButtons
                  label="Bonus for this round"
                  selected={activeRound?.bonus ?? null}
                  disabled={isSavingThisRound || boostLocked || !activeRound}
                  onPick={handleThisRound}
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Next Round</span>
                <MessageLine message={nextBonusMessage} />
                {configLocked && (
                  <div className="p-2 text-xs font-bold rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center space-x-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>{configLockMessage(untilDraw, activeRound?.drawn ?? false)}</span>
                  </div>
                )}
                <BonusButtons
                  label="Bonus for the next round"
                  selected={nextBonus}
                  disabled={isSavingNextBonus || configLocked}
                  onPick={handleNextBonus}
                />
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* The round in progress. The admin sees its real bonus and, once drawn,
          its card; players see neither until the draw. */}
      {activeRound && (
        <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-r from-amber-950/20 via-card to-background border border-amber-500/40 space-y-4 shadow-lg">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center space-x-1.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span>{activeRound.drawn ? `Card Drawn (Round #${activeRound.roundNumber})` : `Round #${activeRound.roundNumber} in Progress`}</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {activeRound.phase === 'settled' ? 'Settled' : activeRound.phase === 'drawing' ? 'Drawing...' : 'Betting Phase (Live)'}
              </span>
            </div>
            <div className="flex items-center space-x-1.5 text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-xl border border-amber-500/20 shrink-0">
              <Clock className="h-4 w-4" />
              <span>{activeRound.drawn ? 'Card selected' : `${untilDraw ?? '—'}s until draw`}</span>
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-4">
            {activeRound.card ? (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Winning card</span>
                <span className="text-3xl sm:text-5xl font-mono bg-amber-500/10 px-4 py-1.5 rounded-2xl border border-amber-500/30">
                  <WinningCard card={activeRound.card} />
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3 py-3 px-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 flex-wrap">
                <Loader2 className="h-5 w-5 text-amber-400 animate-spin shrink-0" />
                <span className="text-sm font-bold text-foreground">Waiting for the winning card to be drawn...</span>
              </div>
            )}
            <div className="flex items-center gap-4 text-xs">
              <div>
                <span className="text-muted-foreground font-semibold block text-[10px]">Bonus</span>
                <BonusBadge bonus={activeRound.bonus} />
              </div>
              <div>
                <span className="text-muted-foreground font-semibold block text-[10px]">Bets so far</span>
                <span className="font-extrabold font-mono text-foreground">{activeRound.playerCount}</span>
              </div>
            </div>
          </div>

          {previous && (
            <div className="pt-3 border-t border-amber-500/20 text-[11px] flex items-center gap-x-3 gap-y-1 flex-wrap text-muted-foreground">
              <span className="font-bold">Previous round #{previous.roundNumber}:</span>
              {previous.rank && previous.suit && <CardFace rank={previous.rank} suit={previous.suit} className="text-sm" />}
              <span className="font-mono">{previous.playerCount} players · wagered <Money amount={previous.totalStake} /> · paid <Money amount={previous.totalPayout} /></span>
              <span>{relativeTime(diffSecondsOf(previous.time))}</span>
            </div>
          )}
        </div>
      )}

      {draws.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center space-x-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Recent Draw Stream (Last 10 Rounds)</span>
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">Live Feed</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-2 table-scroll">
            {draws.slice(0, 10).map(draw => (
              <div
                key={draw.roundId}
                className="px-3 py-2 rounded-xl bg-card border border-border/80 shrink-0 flex items-center space-x-2.5 text-xs font-mono shadow-xs hover:border-primary/40 transition-colors"
              >
                <span className="text-[10px] text-muted-foreground font-semibold">{relativeTime(diffSecondsOf(draw.time))}</span>
                {draw.rank && draw.suit && (
                  <span className="bg-primary/10 px-2 py-0.5 rounded-lg border border-primary/20 text-sm">
                    <CardFace rank={draw.rank} suit={draw.suit} />
                  </span>
                )}
                <BonusBadge bonus={draw.bonus} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-xs space-y-4 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center space-x-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-extrabold tracking-tight text-foreground">Complete Game Draw Ledger</h3>
            <span className="text-[10px] text-muted-foreground font-semibold bg-secondary px-2 py-0.5 rounded-full">
              {filteredDraws.length} Records
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <div className="relative flex-1 sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search round, card (K♠) or id..."
                aria-label="Search the draw ledger"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-xl focus:outline-none focus:border-primary font-medium"
              />
            </div>

            <div className="flex items-center space-x-1 bg-secondary/50 p-1 rounded-xl border border-border">
              <Filter className="h-3 w-3 text-muted-foreground ml-1" />
              {(['ALL', 'WON', 'LOST', 'NO BETS'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => { setStatusFilter(option); setCurrentPage(1) }}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all ${
                    statusFilter === option
                      ? option === 'WON' ? 'bg-emerald-500 text-white'
                        : option === 'LOST' ? 'bg-amber-500 text-white'
                        : option === 'NO BETS' ? 'bg-secondary text-foreground border border-border'
                        : 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option === 'ALL' ? 'All' : option === 'WON' ? 'Won' : option === 'LOST' ? 'Lost' : 'No Bets'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground text-[10px] uppercase font-bold tracking-wider">
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Round</th>
                <th className="py-2.5 px-3">Bonus</th>
                <th className="py-2.5 px-3">Card</th>
                <th className="py-2.5 px-3">Players</th>
                <th className="py-2.5 px-3">Wagered</th>
                <th className="py-2.5 px-3 text-right">Net Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground text-xs font-sans">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                    Loading game draws...
                  </td>
                </tr>
              ) : pageInfo.items.length > 0 ? (
                pageInfo.items.flatMap(draw => {
                  const isExpanded = expandedId === draw.roundId
                  const expandable = draw.playerCount > 0
                  return [
                    <tr
                      key={draw.roundId}
                      onClick={() => toggleDraw(draw)}
                      className={`hover:bg-secondary/40 transition-colors ${expandable ? 'cursor-pointer' : ''} ${isExpanded ? 'bg-secondary/30' : ''}`}
                    >
                      <td className="py-2.5 px-3 text-muted-foreground text-[11px] font-sans">{istTime(draw.time)}</td>
                      <td className="py-2.5 px-3 font-bold text-foreground font-sans">
                        <span className="flex items-center space-x-1.5">
                          <span>#{draw.roundNumber}</span>
                          {expandable && (
                            <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono shrink-0">
                              {isExpanded ? '▲ Hide' : '▼ Details'}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 px-3"><BonusBadge bonus={draw.bonus} /></td>
                      <td className="py-2.5 px-3 text-sm">
                        {draw.rank && draw.suit ? <CardFace rank={draw.rank} suit={draw.suit} /> : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-foreground font-semibold">{draw.playerCount}</td>
                      <td className="py-2.5 px-3 text-foreground font-semibold"><Money amount={draw.totalStake} /></td>
                      <td className={`py-2.5 px-3 text-right font-extrabold ${draw.totalPayout > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                        {draw.totalPayout > 0 ? <Money amount={draw.totalPayout} plus /> : <>0<CoinsSuffix /></>}
                      </td>
                    </tr>,
                    isExpanded && (
                      <tr key={`${draw.roundId}-expanded`} className="bg-secondary/20 border-b border-border/40">
                        <td colSpan={7} className="p-3">
                          <div className="bg-background/90 rounded-xl p-3 border border-border/60">{renderPlayers(draw)}</div>
                        </td>
                      </tr>
                    ),
                  ]
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground text-xs font-sans">
                    No game draws match your filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="block sm:hidden space-y-2.5">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-xs">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
              Loading game draws...
            </div>
          ) : pageInfo.items.length > 0 ? (
            pageInfo.items.map(draw => {
              const isExpanded = expandedId === draw.roundId
              const expandable = draw.playerCount > 0
              return (
                <div
                  key={draw.roundId}
                  onClick={() => toggleDraw(draw)}
                  className={`p-3 rounded-xl bg-secondary/30 border border-border/80 space-y-2 text-xs ${expandable ? 'cursor-pointer' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                      <span className="font-bold text-foreground text-xs font-mono">#{draw.roundNumber}</span>
                      {expandable && (
                        <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono shrink-0">
                          {isExpanded ? '▲ Hide' : '▼ Details'}
                        </span>
                      )}
                    </div>
                    <span className="font-extrabold bg-primary/10 px-2 py-0.5 rounded text-sm border border-primary/20 shrink-0 font-mono">
                      {draw.rank && draw.suit ? <CardFace rank={draw.rank} suit={draw.suit} /> : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center space-x-2 font-mono font-bold">
                      <BonusBadge bonus={draw.bonus} />
                      <span className="text-muted-foreground">{istTime(draw.time)}</span>
                    </div>
                    <span className={`font-extrabold ${draw.totalPayout > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                      {draw.totalPayout > 0 ? <Money amount={draw.totalPayout} plus /> : <>0<CoinsSuffix /></>}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {draw.playerCount} players · wagered <Money amount={draw.totalStake} />
                  </div>
                  {isExpanded && <div className="pt-2 border-t border-border/40">{renderPlayers(draw)}</div>}
                </div>
              )
            })
          ) : (
            <div className="p-4 text-center text-muted-foreground text-xs">No game draws found.</div>
          )}
        </div>

        {pageInfo.totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
            <span className="text-muted-foreground font-medium text-[11px]">
              Page {pageInfo.page} of {pageInfo.totalPages}
            </span>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                aria-label="Previous page"
                onClick={() => setCurrentPage(Math.max(1, pageInfo.page - 1))}
                disabled={pageInfo.page === 1}
                className="p-1.5 rounded-lg bg-secondary border border-border text-foreground hover:bg-secondary/80 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Next page"
                onClick={() => setCurrentPage(Math.min(pageInfo.totalPages, pageInfo.page + 1))}
                disabled={pageInfo.page === pageInfo.totalPages}
                className="p-1.5 rounded-lg bg-secondary border border-border text-foreground hover:bg-secondary/80 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
        <Layers className="h-3 w-3" />
        Lucky Card has its own RTP and bonus settings; Triple Chance&apos;s are on its own tab and are not affected.
      </p>
    </div>
  )
}

/** "K♠" (the text form from cardName) rendered with the suit colour. */
function WinningCard({ card }: { card: string }) {
  const symbol = card.slice(-1)
  const red = symbol === '♥' || symbol === '♦'
  return <span className={`font-black ${red ? 'text-red-400' : 'text-foreground'}`}>{card}</span>
}
