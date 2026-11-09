"use client"

import { useState, useEffect, useCallback } from 'react'
import {
  getLatestGameDrawsAction,
  getRtpAction,
  updateRtpAction,
  getBonusMultiplierAction,
  updateBonusMultiplierAction,
  getActiveRoundTimingAction,
  applyBonusToCurrentRoundAction,
} from '../actions'
import { TC_RTP_MAX, TC_RTP_MIN, TC_RTP_PRESETS, TC_RTP_STEP } from './triple-chance-rtp'
import { useLiveSync } from '@/hooks/use-live-sync'
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
  Trophy,
  Sparkles,
  Search,
  ChevronLeft,
  ChevronRight,
  History,
  Settings2,
  Check,
} from 'lucide-react'
import { roundId, roundMatches } from '@/lib/round-id'

interface PlayerBet {
  username: string
  total_stake: number
  total_payout: number
}

interface GameDraw {
  round_id: string
  round_number: number
  hand_id: string
  red: number
  green: number
  black: number
  result: string
  total_stake: number
  total_payout: number
  player_count: number
  outcome: 'WON' | 'LOST' | 'NO BETS'
  created_at: string
  player_bets: PlayerBet[]
  bonus_multiplier: number
}

interface ActiveRound {
  round_number: number
  round_id: string
  phase: string
  seconds_remaining: number
  seconds_into: number
  draw_at_second: number
  has_digits: boolean
  red: number | null
  green: number | null
  black: number | null
}

function CoinsSuffix() {
  return <span className="text-[9px] font-normal text-muted-foreground/60 ml-0.5">Coins</span>
}

export function TripleChanceLive() {
  const [latestDraws, setLatestDraws] = useState<GameDraw[]>([])
  const [activeRound, setActiveRound] = useState<ActiveRound | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [expandedDrawId, setExpandedDrawId] = useState<string | null>(null)
  const [nowTime, setNowTime] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeRoundFetchedAt, setActiveRoundFetchedAt] = useState<number>(0)

  // RTP Configuration & Bonus Multiplier
  const [rtpValue, setRtpValue] = useState(96.5)
  const [isSavingRtp, setIsSavingRtp] = useState(false)
  const [rtpSuccess, setRtpSuccess] = useState<string | null>(null)
  const [bonusMultiplier, setBonusMultiplier] = useState(1)
  const [isSavingBonusMultiplier, setIsSavingBonusMultiplier] = useState(false)
  const [bonusMultiplierSuccess, setBonusMultiplierSuccess] = useState<string | null>(null)

  const [roundSecondsInto, setRoundSecondsInto] = useState<number | null>(null)
  const displayCountdown = roundSecondsInto === null ? null : Math.max(0, Math.min(90, 90 - roundSecondsInto))
  const roundConfigLocked = displayCountdown !== null && displayCountdown <= 12

  // "This Round" boost
  const [currentRoundBonus, setCurrentRoundBonus] = useState<number | null>(null)
  const [currentRoundDrawn, setCurrentRoundDrawn] = useState(false)
  const [isSavingCurrentRoundBonus, setIsSavingCurrentRoundBonus] = useState(false)
  const [currentRoundBonusMessage, setCurrentRoundBonusMessage] = useState<string | null>(null)
  const [currentRoundBonusIsError, setCurrentRoundBonusIsError] = useState(false)
  const currentRoundLocked = currentRoundDrawn || (roundSecondsInto !== null && roundSecondsInto >= 75)

  // Table search & filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'WON' | 'LOST' | 'NO BETS'>('ALL')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 8

  // Live second ticker
  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const drawsRequest = useRequestGeneration()
  const loadDraws = useCallback(() => {
    const token = drawsRequest.nextGeneration()
    return Promise.all([
      getLatestGameDrawsAction(),
      getRtpAction(),
      getBonusMultiplierAction(),
    ]).then(([res, resRtp, resBonus]) => {
      if (!drawsRequest.isCurrent(token)) return
      setIsLoading(false)
      setIsRefreshing(false)
      const errors = [res.error, resRtp.error, resBonus.error].filter(Boolean)
      setLoadError(errors.length > 0 ? errors.join(' — ') : null)
      if (!res.error) {
        setLatestDraws(res.draws)
        setActiveRound(res.active_round)
        setActiveRoundFetchedAt(Date.now())
      }
      if (resRtp && !resRtp.error && resRtp.rtp) {
        setRtpValue(resRtp.rtp)
      }
      if (resBonus && !resBonus.error && resBonus.bonusMultiplier) {
        setBonusMultiplier(resBonus.bonusMultiplier)
      }
    }).catch((e) => {
      if (!drawsRequest.isCurrent(token)) return
      setIsLoading(false)
      setIsRefreshing(false)
      console.error('Error loading game draws:', e)
      setLoadError(e instanceof Error ? e.message : 'Could not load game draws.')
    })
  }, [drawsRequest])

  const { lastSyncedAt, tierMs, refresh } = useLiveSync(['rounds'], loadDraws, 'fast')

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    refresh()
  }

  const handleApplyRtp = async (targetVal?: number) => {
    const valToApply = targetVal !== undefined ? targetVal : rtpValue
    setIsSavingRtp(true)
    setRtpSuccess(null)
    const res = await updateRtpAction(valToApply)
    setIsSavingRtp(false)
    if (res.success) {
      setRtpValue(valToApply)
      setRtpSuccess(`RTP updated to ${valToApply}%`)
      loadDraws()
      setTimeout(() => setRtpSuccess(null), 2500)
    }
  }

  const handleApplyBonusMultiplier = async (mult: 1 | 2 | 3 | 4) => {
    setIsSavingBonusMultiplier(true)
    setBonusMultiplierSuccess(null)
    const res = await updateBonusMultiplierAction(mult)
    setIsSavingBonusMultiplier(false)
    if (res.success) {
      setBonusMultiplier(mult)
      setBonusMultiplierSuccess(`Bonus set to ${mult === 1 ? 'N (no bonus)' : mult + 'X'} — applies to the next round`)
      loadDraws()
      setTimeout(() => setBonusMultiplierSuccess(null), 2500)
    }
  }

  const handleApplyBonusToCurrentRound = async (mult: 1 | 2 | 3 | 4) => {
    setIsSavingCurrentRoundBonus(true)
    setCurrentRoundBonusMessage(null)
    const res = await applyBonusToCurrentRoundAction(mult)
    setIsSavingCurrentRoundBonus(false)
    if (res.success) {
      setCurrentRoundBonus(res.bonus_multiplier)
      setCurrentRoundBonusIsError(false)
      setCurrentRoundBonusMessage(`Round ${roundId('TC', res.round_number ?? 0)} boosted to ${mult === 1 ? 'N (no bonus)' : mult + 'X'} — live now`)
    } else {
      setCurrentRoundBonusIsError(true)
      setCurrentRoundBonusMessage(res.error ?? 'Could not apply bonus.')
    }
    setTimeout(() => setCurrentRoundBonusMessage(null), 3500)
  }

  // Dedicated poll for the RTP/Bonus round-lock countdown -- pauses when the
  // browser tab is hidden (e.g. user on another tab/window) and catches up
  // immediately upon return, matching useLiveSync's visibility behavior.
  useEffect(() => {
    if (typeof document === 'undefined') return

    let cancelled = false
    let inFlight = false
    let timingPoll: ReturnType<typeof setInterval> | null = null

    const poll = () => {
      if (inFlight) return
      inFlight = true
      getActiveRoundTimingAction().then(res => {
        if (cancelled) return
        setRoundSecondsInto(res.seconds_into)
        setCurrentRoundBonus(res.current_round_bonus_multiplier)
        setCurrentRoundDrawn(res.current_round_drawn)
      }).finally(() => {
        inFlight = false
      })
    }

    const start = () => {
      if (timingPoll) return
      timingPoll = setInterval(poll, 2000)
    }
    const stop = () => {
      if (!timingPoll) return
      clearInterval(timingPoll)
      timingPoll = null
    }

    if (document.visibilityState === 'visible') {
      poll()
      start()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        poll()
        start()
      } else {
        stop()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  // Filtered draws for historical table
  const filteredDraws = latestDraws.filter(draw => {
    const matchesSearch =
      draw.result.toString().includes(searchQuery) ||
      roundMatches('TC', draw.round_number, searchQuery) ||
      (draw.player_bets ?? []).some(pb => pb.username.toLowerCase().includes(searchQuery.toLowerCase()))

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'WON' && draw.outcome === 'WON') ||
      (statusFilter === 'LOST' && draw.outcome === 'LOST') ||
      (statusFilter === 'NO BETS' && draw.outcome === 'NO BETS')

    return matchesSearch && matchesStatus
  })

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredDraws.length / itemsPerPage))
  const paginatedDraws = filteredDraws.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black text-foreground">Triple Chance</h2>
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

      {/* RTP Configuration & Bonus Multiplier */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card border-border/80 shadow-md rounded-2xl p-3.5 sm:p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Settings2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground leading-tight">RTP Configuration</h3>
                <p className={`text-[10px] font-bold ${
                  rtpValue < 92 ? 'text-amber-500' : rtpValue <= 96.5 ? 'text-success-text' : rtpValue < 100 ? 'text-blue-400' : 'text-emerald-400'
                }`}>
                  {rtpValue < 92 ? 'Aggressive Yield' : rtpValue <= 96.5 ? 'Balanced (Recommended)' : rtpValue < 100 ? 'Player Friendly' : '100% Full Return'}
                </p>
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
              {rtpSuccess && (
                <div className="p-1.5 text-[11px] font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20 flex items-center space-x-1.5">
                  <Check className="h-3.5 w-3.5 text-success-text shrink-0" />
                  <span>{rtpSuccess}</span>
                </div>
              )}

              {roundConfigLocked && (
                <div className="p-1.5 text-[11px] font-bold rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center space-x-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>Locked — betting closes in {displayCountdown}s. Unlocks automatically when the next round starts.</span>
                </div>
              )}

              <div className="space-y-1">
                <Slider
                  value={[rtpValue]}
                  onValueChange={(val) => {
                    if (typeof val === 'number') {
                      setRtpValue(val)
                    } else if (Array.isArray(val) && typeof val[0] === 'number') {
                      setRtpValue(val[0])
                    }
                  }}
                  max={TC_RTP_MAX}
                  min={TC_RTP_MIN}
                  step={TC_RTP_STEP}
                  disabled={roundConfigLocked}
                  formatValue={(v) => `${v}%`}
                  className="w-full cursor-pointer disabled:opacity-50"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                  <span>{TC_RTP_MIN}%</span>
                  <span>{TC_RTP_MAX}%</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto table-scroll pb-1">
                {TC_RTP_PRESETS.map((p) => {
                  const isCurrent = Math.abs(rtpValue - p) < 0.01
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={roundConfigLocked}
                      onClick={() => {
                        setRtpValue(p)
                        handleApplyRtp(p)
                      }}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                        isCurrent
                          ? 'bg-amber-500 text-slate-950 shadow-xs shadow-amber-500/30 font-black'
                          : 'bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50'
                      }`}
                    >
                      {p}%
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-muted-foreground font-mono">
                  House edge: <strong className="text-foreground">{(100 - rtpValue).toFixed(1)}%</strong>
                </span>
                <Button
                  onClick={() => handleApplyRtp()}
                  disabled={isSavingRtp || roundConfigLocked}
                  size="sm"
                  className="h-7 px-3 text-xs font-bold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer disabled:opacity-50"
                >
                  {isSavingRtp ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                      Saving...
                    </>
                  ) : (
                    'Apply Target RTP'
                  )}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Bonus Multiplier Configuration */}
        <Card className="bg-card border-border/80 shadow-md rounded-2xl p-3.5 sm:p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground leading-tight">Bonus Multiplier</h3>
                <p className="text-[10px] text-muted-foreground font-medium">
                  {currentRoundBonus !== null && currentRoundBonus > 1 ? (
                    <>Current: <strong className="text-amber-400 font-bold">{currentRoundBonus}X Active</strong> · Next: <strong className="text-foreground">{bonusMultiplier === 1 ? 'N' : `${bonusMultiplier}X`}</strong></>
                  ) : (
                    <>Next round multiplier ({bonusMultiplier === 1 ? 'N — normal payouts' : `${bonusMultiplier}X boost`})</>
                  )}
                </p>
              </div>
            </div>
            <span className={`font-mono font-black text-lg px-2 py-0.5 rounded-lg border ${
              bonusMultiplier === 1
                ? 'text-muted-foreground bg-secondary/50 border-border/60'
                : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
            }`}>
              {bonusMultiplier === 1 ? 'N' : `${bonusMultiplier}X`}
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-2 p-2 animate-pulse">
              <div className="h-4 bg-secondary/80 rounded w-full" />
              <div className="h-6 bg-secondary/60 rounded w-full" />
            </div>
          ) : (
            <div className="space-y-2.5">
              {bonusMultiplierSuccess && (
                <div className="p-1.5 text-[11px] font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20 flex items-center space-x-1.5">
                  <Check className="h-3.5 w-3.5 text-success-text shrink-0" />
                  <span>{bonusMultiplierSuccess}</span>
                </div>
              )}

              {currentRoundBonusMessage && (
                <div className={`p-1.5 text-[11px] font-bold rounded-lg flex items-center space-x-1.5 border ${
                  currentRoundBonusIsError
                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }`}>
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  <span>{currentRoundBonusMessage}</span>
                </div>
              )}

              {roundConfigLocked && (
                <div className="p-1.5 text-[11px] font-bold rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center space-x-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>Locked — betting closes in {displayCountdown}s. Unlocks automatically when the next round starts.</span>
                </div>
              )}

              <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">Boost This Round (Live Now)</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {currentRoundBonus !== null ? (
                      currentRoundBonus === 1 ? 'currently N (1X)' : `currently ${currentRoundBonus}X`
                    ) : 'reading...'}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {([1, 2, 3, 4] as const).map((mult) => {
                    const isLiveOnCurrent = currentRoundBonus === mult
                    const isSaving = isSavingCurrentRoundBonus
                    return (
                      <button
                        key={mult}
                        type="button"
                        disabled={currentRoundLocked || isSaving}
                        onClick={() => handleApplyBonusToCurrentRound(mult)}
                        className={`py-1.5 px-2 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer flex flex-col items-center justify-center border disabled:opacity-40 disabled:cursor-not-allowed ${
                          isLiveOnCurrent
                            ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm shadow-amber-500/30 font-black'
                            : 'bg-card hover:bg-secondary text-foreground border-border/70 hover:border-amber-500/40'
                        }`}
                      >
                        <span className="text-[11px] leading-tight">{mult === 1 ? 'N' : `${mult}X`}</span>
                        <span className="text-[8px] opacity-75 font-normal">{mult === 1 ? '1X' : `${mult}X win`}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-[9px] text-muted-foreground leading-tight">
                  {currentRoundLocked ? (
                    currentRoundDrawn ? (
                      <span className="text-muted-foreground">Round has been drawn. Wait for next round.</span>
                    ) : (
                      <span className="text-amber-500/90 font-medium">Locked for draw (second 75+). Cannot boost this round anymore.</span>
                    )
                  ) : (
                    <>Applies <strong className="text-amber-400">immediately</strong> to the round running right now. Safe to use until second 75.</>
                  )}
                </p>
              </div>

              <div className="space-y-1 pt-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Queue for Next Round</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {([1, 2, 3, 4] as const).map((mult) => {
                    const isSelected = bonusMultiplier === mult
                    const isSaving = isSavingBonusMultiplier
                    return (
                      <button
                        key={mult}
                        type="button"
                        disabled={roundConfigLocked || isSaving}
                        onClick={() => handleApplyBonusMultiplier(mult)}
                        className={`py-1 px-2 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer flex flex-col items-center justify-center border disabled:opacity-40 disabled:cursor-not-allowed ${
                          isSelected
                            ? 'bg-secondary text-foreground border-amber-500/50 shadow-xs font-black'
                            : 'bg-secondary/40 hover:bg-secondary text-muted-foreground hover:text-foreground border-border/50'
                        }`}
                      >
                        <span className="text-[11px] leading-tight">{mult === 1 ? 'N' : `${mult}X`}</span>
                        <span className="text-[8px] opacity-75 font-normal">{mult === 1 ? 'normal' : `${mult}X`}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-[9px] text-muted-foreground leading-tight">
                  Queued in game config. Automatically resets to N after the round opens.
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Live Round Telemetry & Recent Streams Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Active Live Round Card */}
        <Card className="lg:col-span-1 bg-card border-border shadow-md rounded-2xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />

          <div>
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div className="flex items-center space-x-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Active Round</span>
              </div>
              <span className="font-mono text-xs font-black text-primary px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                {activeRound ? roundId('TC', activeRound.round_number) : 'TC-SYNCING'}
              </span>
            </div>

            <div className="py-5 text-center space-y-3">
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Live Multi-Wheel Draw</div>
              <div className="flex items-center justify-center space-x-3">
                <div className="flex flex-col items-center">
                  <div className="w-14 h-16 sm:w-16 sm:h-20 rounded-2xl bg-secondary/80 border-2 border-red-500/40 flex items-center justify-center shadow-inner">
                    <span className="font-mono text-3xl sm:text-4xl font-black text-red-400">
                      {activeRound?.red !== null && activeRound?.red !== undefined ? activeRound.red : '-'}
                    </span>
                  </div>
                  <span className="text-[9px] font-bold text-red-400/80 mt-1 uppercase">Wheel 1</span>
                </div>

                <span className="text-xl font-bold text-muted-foreground/30">•</span>

                <div className="flex flex-col items-center">
                  <div className="w-14 h-16 sm:w-16 sm:h-20 rounded-2xl bg-secondary/80 border-2 border-emerald-500/40 flex items-center justify-center shadow-inner">
                    <span className="font-mono text-3xl sm:text-4xl font-black text-emerald-400">
                      {activeRound?.green !== null && activeRound?.green !== undefined ? activeRound.green : '-'}
                    </span>
                  </div>
                  <span className="text-[9px] font-bold text-emerald-400/80 mt-1 uppercase">Wheel 2</span>
                </div>

                <span className="text-xl font-bold text-muted-foreground/30">•</span>

                <div className="flex flex-col items-center">
                  <div className="w-14 h-16 sm:w-16 sm:h-20 rounded-2xl bg-secondary/80 border-2 border-border flex items-center justify-center shadow-inner">
                    <span className="font-mono text-3xl sm:text-4xl font-black text-foreground">
                      {activeRound?.black !== null && activeRound?.black !== undefined ? activeRound.black : '-'}
                    </span>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground mt-1 uppercase">Wheel 3</span>
                </div>
              </div>

              {activeRound?.has_digits ? (
                <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
                  <span>Result Confirmed:</span>
                  <span className="font-mono text-sm tracking-wider font-extrabold">{activeRound.red}{activeRound.green}{activeRound.black}</span>
                </div>
              ) : (
                <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-secondary text-muted-foreground border border-border text-xs font-semibold">
                  <Clock className="h-3 w-3 animate-spin" />
                  <span>Awaiting Draw Execution...</span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-border/80 flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-semibold">Cycle Phase:</span>
            {(() => {
              const fetchedSecondsInto = activeRound?.seconds_into ?? 0
              const elapsedSinceFetch = activeRoundFetchedAt > 0 && nowTime > 0
                ? Math.floor((nowTime - activeRoundFetchedAt) / 1000)
                : 0
              const currentSecondsInto = Math.min(103, fetchedSecondsInto + elapsedSinceFetch)
              const remainingSecs = Math.max(0, 90 - currentSecondsInto)
              const isLocked = currentSecondsInto >= 90

              return (
                <span className={`font-mono font-bold px-2 py-0.5 rounded-md ${
                  isLocked ? 'text-amber-400 bg-amber-500/10' : 'text-emerald-400 bg-emerald-500/10'
                }`}>
                  {isLocked ? (
                    'DRAW / SETTLING'
                  ) : (
                    <>BETTING ({remainingSecs}s)</>
                  )}
                </span>
              )
            })()}
          </div>
        </Card>

        {/* Recent Draw Stream Carousel */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <History className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-extrabold text-foreground">Recent Draw Stream</h3>
            </div>
            <span className="text-[10px] text-muted-foreground font-semibold font-mono">Last 20 Settled Rounds</span>
          </div>

          {isLoading ? (
            <div className="h-32 flex items-center justify-center bg-card rounded-2xl border border-border">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex space-x-3 overflow-x-auto pb-2 table-scroll">
              {latestDraws.slice(0, 10).map((draw) => (
                <div
                  key={draw.round_id}
                  className="shrink-0 w-28 sm:w-32 bg-card border border-border/80 hover:border-primary/40 transition-colors p-3 rounded-2xl flex flex-col justify-between space-y-2 shadow-xs"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                    <span className="truncate">{roundId('TC', draw.round_number)}</span>
                    <span className={`px-1 rounded text-[8px] font-black ${
                      draw.outcome === 'WON'
                        ? 'text-emerald-400 bg-emerald-500/10'
                        : draw.outcome === 'LOST'
                        ? 'text-red-400 bg-red-500/10'
                        : 'text-muted-foreground bg-secondary'
                    }`}>
                      {draw.outcome}
                    </span>
                  </div>

                  <div className="flex items-center justify-center space-x-1.5 py-1">
                    <span className="w-6 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center font-mono font-black text-sm">
                      {draw.red}
                    </span>
                    <span className="w-6 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-mono font-black text-sm">
                      {draw.green}
                    </span>
                    <span className="w-6 h-8 rounded-lg bg-secondary border border-border text-foreground flex items-center justify-center font-mono font-black text-sm">
                      {draw.black}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] pt-1 border-t border-border/40 font-mono">
                    <span className="text-muted-foreground truncate">{draw.player_count} players</span>
                    <span className="font-extrabold text-foreground truncate">{formatCurrency(draw.total_stake)}<CoinsSuffix /></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Global Historical Draw Ledger (Desktop Table View) */}
      <div className="bg-card border border-border/80 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center space-x-2">
            <Trophy className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-extrabold text-foreground">Round Draw Ledger</h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search result or player..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
                className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-secondary/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary w-44"
              />
            </div>

            <div className="flex items-center bg-secondary/80 rounded-xl p-0.5 border border-border text-xs">
              {(['ALL', 'WON', 'LOST', 'NO BETS'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => {
                    setStatusFilter(filter)
                    setCurrentPage(1)
                  }}
                  className={`px-2.5 py-1 rounded-lg font-bold text-[10px] transition-all cursor-pointer ${
                    statusFilter === filter
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table representation for Desktop */}
        <div className="overflow-x-auto table-scroll hidden md:block">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground font-semibold">
                <th className="py-2.5 px-3">Round Number</th>
                <th className="py-2.5 px-3">Winning Digits</th>
                <th className="py-2.5 px-3">Result</th>
                <th className="py-2.5 px-3">Total Stake</th>
                <th className="py-2.5 px-3">Total Payout</th>
                <th className="py-2.5 px-3">Players</th>
                <th className="py-2.5 px-3">Outcome</th>
                <th className="py-2.5 px-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {paginatedDraws.length > 0 ? (
                paginatedDraws.map((draw) => {
                  const isExpanded = expandedDrawId === draw.round_id
                  const hasMultiple = draw.player_bets && draw.player_bets.length > 0

                  return (
                    <tr
                      key={draw.round_id}
                      onClick={() => hasMultiple && setExpandedDrawId(isExpanded ? null : draw.round_id)}
                      className={`hover:bg-secondary/30 transition-colors ${hasMultiple ? 'cursor-pointer' : ''}`}
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-foreground">
                        <div className="flex items-center space-x-1.5">
                          <span>{roundId('TC', draw.round_number)}</span>
                          {hasMultiple && (
                            <span className="text-[10px] text-primary bg-primary/10 px-1 rounded font-mono">
                              {isExpanded ? '▲' : '▼'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center space-x-1.5 font-mono font-bold">
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-black shrink-0 ${
                            draw.bonus_multiplier === 1
                              ? 'text-muted-foreground bg-secondary/40 border border-border/60'
                              : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                          }`}>
                            {draw.bonus_multiplier === 1 ? 'N' : `${draw.bonus_multiplier}X`}
                          </span>
                          <span className="text-red-400">{draw.red}</span>
                          <span className="text-muted-foreground/40">•</span>
                          <span className="text-emerald-400">{draw.green}</span>
                          <span className="text-muted-foreground/40">•</span>
                          <span className="text-foreground">{draw.black}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-extrabold bg-primary/10 px-2 py-0.5 rounded text-xs border border-primary/20">
                          <span className="text-red-400">{draw.red}</span>
                          <span className="text-emerald-400">{draw.green}</span>
                          <span className="text-foreground">{draw.black}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-muted-foreground">
                        {formatCurrency(draw.total_stake)}<CoinsSuffix />
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <span className={`font-bold ${draw.total_payout > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                          {draw.total_payout > 0 ? `+${formatCurrency(draw.total_payout)}` : '0'}<CoinsSuffix />
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">
                        {draw.player_count > 0 ? (
                          <span className="font-semibold text-foreground">{draw.player_count}</span>
                        ) : (
                          '0'
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold tracking-wide ${
                          draw.outcome === 'WON'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : draw.outcome === 'LOST'
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                            : 'bg-secondary text-muted-foreground border border-border'
                        }`}>
                          {draw.outcome}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-muted-foreground text-[11px]">
                        {new Date(draw.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-muted-foreground">
                    No matching draws found in ledger.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Feed Layout */}
        <div className="md:hidden space-y-2.5">
          {paginatedDraws.length > 0 ? (
            paginatedDraws.map((draw) => {
              const isExpanded = expandedDrawId === draw.round_id
              const hasMultiple = draw.player_bets && draw.player_bets.length > 0

              return (
                <div
                  key={draw.round_id}
                  onClick={() => hasMultiple && setExpandedDrawId(isExpanded ? null : draw.round_id)}
                  className={`p-3 rounded-xl bg-secondary/30 border border-border/80 space-y-2 text-xs ${hasMultiple ? 'cursor-pointer' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                      <span className="font-bold text-foreground text-[10px] font-mono break-all">{roundId('TC', draw.round_number)}</span>
                      {hasMultiple && (
                        <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.2 rounded font-mono shrink-0">
                          {isExpanded ? '▲ Hide' : '▼ Details'}
                        </span>
                      )}
                    </div>
                    <span className="font-extrabold bg-primary/10 px-2 py-0.5 rounded text-xs border border-primary/20 shrink-0 font-mono">
                      <span className="text-red-400">{draw.red}</span>
                      <span className="text-emerald-400">{draw.green}</span>
                      <span className="text-foreground">{draw.black}</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center space-x-1.5 font-mono font-bold">
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-black shrink-0 ${
                        draw.bonus_multiplier === 1
                          ? 'text-muted-foreground bg-secondary/40 border border-border/60'
                          : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                      }`}>
                        {draw.bonus_multiplier === 1 ? 'N' : `${draw.bonus_multiplier}X`}
                      </span>
                      <span className="text-red-400">{draw.red}</span>
                      <span className="text-muted-foreground/40">•</span>
                      <span className="text-emerald-400">{draw.green}</span>
                      <span className="text-muted-foreground/40">•</span>
                      <span className="text-foreground">{draw.black}</span>
                    </div>
                    <span className={`font-extrabold ${draw.total_payout > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                      {draw.total_payout > 0 ? <>+{formatCurrency(draw.total_payout)}</> : '0'}<CoinsSuffix />
                    </span>
                  </div>

                  {isExpanded && draw.player_bets && draw.player_bets.length > 0 && (
                    <div className="pt-2 border-t border-border/40 space-y-1.5">
                      <div className="text-[10px] font-bold text-primary">Participating Players ({draw.player_bets.length})</div>
                      {draw.player_bets.map((pb, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-background/80 p-2 rounded-lg border border-border/40 text-[11px]">
                          <span className="font-bold text-foreground">@{pb.username}</span>
                          <div className="flex items-center space-x-2 font-mono">
                            <span className="text-muted-foreground">Bet: {formatCurrency(pb.total_stake)}<CoinsSuffix /></span>
                            <span className={pb.total_payout > 0 ? 'text-emerald-400 font-extrabold' : 'text-muted-foreground'}>
                              {pb.total_payout > 0 ? <>+{formatCurrency(pb.total_payout)}</> : '0'}<CoinsSuffix />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <div className="p-4 text-center text-muted-foreground text-xs">
              No game draws found.
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
            <span className="text-muted-foreground font-medium text-[11px]">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg bg-secondary border border-border text-foreground hover:bg-secondary/80 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg bg-secondary border border-border text-foreground hover:bg-secondary/80 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
