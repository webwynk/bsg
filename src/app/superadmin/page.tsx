"use client"

import * as React from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Users, Coins, Activity, Percent, Settings2, ShieldCheck, TrendingUp, RefreshCw, Check, Loader2, ArrowUpRight, Search, Gamepad2, Sparkles, Clock, Radio, Dices, Trophy } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResponsivePagination } from '@/components/responsive-pagination'
import { getRtpAction, updateRtpAction, getAuditLogsAction, getSystemOverviewMetricsAction, getLatestGameDrawsAction } from './actions'
import { formatCurrency } from '@/lib/utils'

export default function SuperAdminDashboard() {
  const [rtpValue, setRtpValue] = React.useState(96.5)
  const [totalCoins, setTotalCoins] = React.useState(0)
  const [todaysCoins, setTodaysCoins] = React.useState(0)
  const [activeAgents, setActiveAgents] = React.useState(0)
  const [activePlayers, setActivePlayers] = React.useState(0)

  // Gameplay & Bet Volume Metrics State
  const [gameplayScope, setGameplayScope] = React.useState<'today' | 'lifetime'>('today')
  const [totalBetsCount, setTotalBetsCount] = React.useState(0)
  const [totalBetCoins, setTotalBetCoins] = React.useState(0)
  const [totalWinCoins, setTotalWinCoins] = React.useState(0)
  const [totalLostCoins, setTotalLostCoins] = React.useState(0)
  const [todayBetsCount, setTodayBetsCount] = React.useState(0)
  const [todayBetCoins, setTodayBetCoins] = React.useState(0)
  const [todayWinCoins, setTodayWinCoins] = React.useState(0)
  const [todayLostCoins, setTodayLostCoins] = React.useState(0)

  // Live Draw Monitor & Multi-Game State
  const [selectedGameTab, setSelectedGameTab] = React.useState<'triple_chance' | 'game_2' | 'game_3'>('triple_chance')
  const [latestDraws, setLatestDraws] = React.useState<Array<{
    id: string
    game: string
    resultNumber: number
    redDigit: number
    greenDigit: number
    blackDigit: number
    betAmount: number
    winAmount: number
    status: string
    playerUsername: string
    createdAt: string
  }>>([])
  const [nowTime, setNowTime] = React.useState(Date.now())

  const [systemLogs, setSystemLogs] = React.useState<Array<{ id: string; type: string; detail: string; time: string }>>([])
  const [isLoadingMetrics, setIsLoadingMetrics] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [isSavingRtp, setIsSavingRtp] = React.useState(false)
  const [rtpSuccess, setRtpSuccess] = React.useState<string | null>(null)

  // Log Filter, Search & Pagination states
  const [logCategory, setLogCategory] = React.useState<'ALL' | 'System' | 'Transaction' | 'Security'>('ALL')
  const [logSearchQuery, setLogSearchQuery] = React.useState('')
  const [logPage, setLogPage] = React.useState(1)
  const logsPerPage = 4

  // Live 1-second Ticker Interval for Relative Timestamps (e.g. 25s ago)
  React.useEffect(() => {
    const ticker = setInterval(() => {
      setNowTime(Date.now())
    }, 1000)
    return () => clearInterval(ticker)
  }, [])

  const fetchMetrics = () => {
    setIsLoadingMetrics(true)
    Promise.all([
      getSystemOverviewMetricsAction(),
      getRtpAction(),
      getAuditLogsAction(),
      getLatestGameDrawsAction()
    ]).then(([resMetrics, resRtp, resLogs, resDraws]) => {
      setIsLoadingMetrics(false)
      if (resMetrics) {
        setTotalCoins(resMetrics.totalCoins || 0)
        setTodaysCoins(resMetrics.todaysCoinsIssued || 0)
        setActiveAgents(resMetrics.activeAgents || 0)
        setActivePlayers(resMetrics.activePlayers || 0)
        setTotalBetsCount(resMetrics.totalBetsCount || 0)
        setTotalBetCoins(resMetrics.totalBetCoins || 0)
        setTotalWinCoins(resMetrics.totalWinCoins || 0)
        setTotalLostCoins(resMetrics.totalLostCoins || 0)
        setTodayBetsCount(resMetrics.todayBetsCount || 0)
        setTodayBetCoins(resMetrics.todayBetCoins || 0)
        setTodayWinCoins(resMetrics.todayWinCoins || 0)
        setTodayLostCoins(resMetrics.todayLostCoins || 0)
      }
      if (resRtp?.rtp) {
        setRtpValue(resRtp.rtp)
      }
      if (resLogs?.logs) {
        setSystemLogs(resLogs.logs)
      }
      if (resDraws?.draws) {
        setLatestDraws(resDraws.draws)
      }
    }).catch(() => setIsLoadingMetrics(false))
  }

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    fetchMetrics()
    setTimeout(() => setIsRefreshing(false), 500)
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
      fetchMetrics()
      setTimeout(() => setRtpSuccess(null), 2500)
    }
  }

  React.useEffect(() => {
    fetchMetrics()
    const autoPoll = setInterval(() => {
      fetchMetrics()
    }, 5000)
    return () => clearInterval(autoPoll)
  }, [])

  // Filtered & Paginated Logs
  const filteredLogs = React.useMemo(() => {
    return systemLogs.filter(log => {
      if (logCategory !== 'ALL' && log.type.toUpperCase() !== logCategory.toUpperCase()) {
        return false
      }
      if (logSearchQuery.trim()) {
        const query = logSearchQuery.toLowerCase()
        return log.detail.toLowerCase().includes(query) || log.type.toLowerCase().includes(query)
      }
      return true
    })
  }, [systemLogs, logCategory, logSearchQuery])

  const paginatedLogs = React.useMemo(() => {
    const start = (logPage - 1) * logsPerPage
    return filteredLogs.slice(start, start + logsPerPage)
  }, [filteredLogs, logPage])

  // Reset page when log filter changes
  React.useEffect(() => {
    setLogPage(1)
  }, [logCategory, logSearchQuery])

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto px-2 sm:px-4 md:px-0 pb-12">
      {/* Page Title Header (Mobile First Inline Header) */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-base sm:text-xl font-black tracking-tight text-foreground">
              System Overview
            </h1>
            <span className="px-2 py-0.5 text-[9px] sm:text-[10px] font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
              God Mode
            </span>
          </div>
          <p className="text-muted-foreground text-[11px] sm:text-xs hidden sm:block">
            Real-time management dashboard and network controls.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Auto-Sync (30s)
          </span>
          <Button 
            onClick={handleManualRefresh} 
            variant="outline" 
            size="sm" 
            className="h-7.5 sm:h-8 text-[11px] sm:text-xs font-extrabold px-2.5 sm:px-3 rounded-xl border-border/80 hover:bg-secondary cursor-pointer shrink-0 w-auto"
          >
            <RefreshCw className={`mr-1 sm:mr-1.5 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Top 3 Overview Micro Cards (3-Column Micro Strip Grid on Mobile) */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
        {/* Card 1: Today's Coins Issued (Asia/Kolkata IST 00:00 reset) */}
        <Link href="/superadmin/agents/issued" className="block cursor-pointer group">
          <Card className="bg-card border-border/80 shadow-2xs rounded-xl p-2 sm:p-3 group-hover:border-primary/50 group-hover:shadow-md transition-all duration-200 h-full">
            <div className="flex items-center justify-between">
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors truncate">
                Today Issued
              </span>
              <div className="p-1 sm:p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white transition-colors shrink-0 hidden sm:block">
                <Coins className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
            </div>
            <div className="mt-0.5 sm:mt-1.5">
              {isLoadingMetrics || isRefreshing ? (
                <div className="h-5 sm:h-6 w-14 sm:w-20 bg-secondary/80 animate-pulse rounded my-0.5" />
              ) : (
                <div className="text-xs sm:text-2xl font-black font-mono tracking-tight text-emerald-500 flex items-center justify-between">
                  <span className="truncate">{formatCurrency(todaysCoins)}</span>
                  <ArrowUpRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0 hidden sm:block" />
                </div>
              )}
              <div className="flex items-center space-x-1 mt-0.5 text-[8px] sm:text-[10px]">
                <TrendingUp className="h-2.5 w-2.5 text-emerald-500 shrink-0 hidden sm:block" />
                <span className="text-emerald-500 font-extrabold truncate">Resets 00:00 IST</span>
              </div>
            </div>
          </Card>
        </Link>

        {/* Card 2: Active Network */}
        <Card className="bg-card border-border/80 shadow-2xs rounded-xl p-2 sm:p-3 transition-all duration-200">
          <div className="flex items-center justify-between">
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">Network</span>
            <div className="p-1 sm:p-1.5 rounded-lg bg-blue-500/10 text-blue-500 shrink-0 hidden sm:block">
              <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="mt-0.5 sm:mt-1.5">
            {isLoadingMetrics || isRefreshing ? (
              <div className="h-5 sm:h-6 w-12 sm:w-16 bg-secondary/80 animate-pulse rounded my-0.5" />
            ) : (
              <div className="text-xs sm:text-2xl font-black font-mono tracking-tight text-foreground truncate">
                {activeAgents} <span className="text-[9px] font-semibold text-muted-foreground sm:hidden">Ag</span><span className="text-[10px] font-normal text-muted-foreground hidden sm:inline">Agents</span> / {activePlayers} <span className="text-[9px] font-semibold text-muted-foreground sm:hidden">Pl</span>
              </div>
            )}
            <p className="text-[8px] sm:text-[10px] text-muted-foreground mt-0.5 truncate hidden sm:block">
              <strong className="text-foreground font-bold">{activePlayers}</strong> registered players
            </p>
            <p className="text-[8px] text-muted-foreground mt-0.5 truncate sm:hidden">
              Agents & Players
            </p>
          </div>
        </Card>

        {/* Card 3: Global RTP Target */}
        <Card className="bg-card border-border/80 shadow-2xs rounded-xl p-2 sm:p-3 transition-all duration-200">
          <div className="flex items-center justify-between">
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">Global RTP</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 shrink-0 hidden sm:block">
              <Percent className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="mt-0.5 sm:mt-1.5">
            {isLoadingMetrics ? (
              <div className="h-5 sm:h-6 w-12 sm:w-16 bg-secondary/80 animate-pulse rounded my-0.5" />
            ) : (
              <div className="text-xs sm:text-2xl font-black font-mono tracking-tight text-amber-500">{rtpValue}%</div>
            )}
            <div className="flex items-center space-x-1 mt-0.5 text-[8px] sm:text-[10px] text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="truncate">Active</span>
            </div>
          </div>
        </Card>
      </div>

      {/* 📊 Unified Gameplay & Bets Audit Widget (Compact Mobile First Layout) */}
      <Card className="bg-card border-border/80 shadow-2xs rounded-2xl p-2.5 sm:p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-1 border-b border-border/50 pb-2">
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            <div className="p-1 sm:p-1.5 rounded-lg sm:rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
              <Gamepad2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <div>
              <h2 className="text-xs sm:text-base font-black tracking-tight text-foreground leading-tight">
                Gameplay & Bets Audit
              </h2>
              <p className="text-[10px] text-muted-foreground font-semibold hidden sm:block">
                Network-wide bet counts, total wagered coins, payouts, and net house profit.
              </p>
            </div>
          </div>

          {/* Scope Toggle Pills: Today (IST) vs Lifetime */}
          <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[9px] sm:text-[10px] font-bold shrink-0">
            <button
              onClick={() => setGameplayScope('today')}
              className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg transition-all cursor-pointer ${
                gameplayScope === 'today'
                  ? 'bg-primary text-primary-foreground font-black shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Today (IST)
            </button>
            <button
              onClick={() => setGameplayScope('lifetime')}
              className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg transition-all cursor-pointer ${
                gameplayScope === 'lifetime'
                  ? 'bg-primary text-primary-foreground font-black shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Lifetime
            </button>
          </div>
        </div>

        {/* 4-Metric High-Density Grid (2-Column Mobile / 4-Column Desktop) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-3 sm:divide-x divide-border/60">
          {/* Metric 1: Bet Count (Number of Plays) */}
          <div className="p-2 sm:p-0 rounded-xl bg-secondary/20 sm:bg-transparent border border-border/40 sm:border-0 space-y-0.5">
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground block truncate">
              Bets Placed
            </span>
            {isLoadingMetrics || isRefreshing ? (
              <div className="h-5 sm:h-6 w-14 sm:w-16 bg-secondary/80 animate-pulse rounded my-0.5" />
            ) : (
              <div className="text-xs sm:text-xl font-black font-mono text-foreground truncate">
                {gameplayScope === 'today' ? todayBetsCount : totalBetsCount} <span className="text-[10px] sm:text-[11px] text-muted-foreground font-normal">Plays</span>
              </div>
            )}
            <p className="text-[9px] text-muted-foreground/70 hidden sm:block">Total bets placed by players</p>
          </div>

          {/* Metric 2: Coins Wagered (In) */}
          <div className="p-2 sm:p-0 sm:pl-3 rounded-xl bg-secondary/20 sm:bg-transparent border border-border/40 sm:border-0 space-y-0.5">
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground block truncate">
              Coins Bet (In)
            </span>
            {isLoadingMetrics || isRefreshing ? (
              <div className="h-5 sm:h-6 w-16 sm:w-20 bg-secondary/80 animate-pulse rounded my-0.5" />
            ) : (
              <div className="text-xs sm:text-xl font-black font-mono text-foreground truncate">
                {formatCurrency(gameplayScope === 'today' ? todayBetCoins : totalBetCoins)}
              </div>
            )}
            <p className="text-[9px] text-muted-foreground/70 hidden sm:block">Total wagered coins</p>
          </div>

          {/* Metric 3: Coins Won (Out) */}
          <div className="p-2 sm:p-0 sm:pl-3 rounded-xl bg-secondary/20 sm:bg-transparent border border-border/40 sm:border-0 space-y-0.5">
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground block truncate">
              Coins Won (Out)
            </span>
            {isLoadingMetrics || isRefreshing ? (
              <div className="h-5 sm:h-6 w-16 sm:w-20 bg-secondary/80 animate-pulse rounded my-0.5" />
            ) : (
              <div className="text-xs sm:text-xl font-black font-mono text-amber-500 truncate">
                {formatCurrency(gameplayScope === 'today' ? todayWinCoins : totalWinCoins)}
              </div>
            )}
            <p className="text-[9px] text-muted-foreground/70 hidden sm:block">Returned to winning players</p>
          </div>

          {/* Metric 4: Net Lost Coins (House P/L) */}
          <div className="p-2 sm:p-0 sm:pl-3 rounded-xl bg-secondary/20 sm:bg-transparent border border-border/40 sm:border-0 space-y-0.5">
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground block truncate">
              Net Lost (House P/L)
            </span>
            {isLoadingMetrics || isRefreshing ? (
              <div className="h-5 sm:h-6 w-16 sm:w-20 bg-secondary/80 animate-pulse rounded my-0.5" />
            ) : (
              <div className={`text-xs sm:text-xl font-black font-mono truncate ${(gameplayScope === 'today' ? todayLostCoins : totalLostCoins) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {(gameplayScope === 'today' ? todayLostCoins : totalLostCoins) >= 0 ? '+' : ''}
                {formatCurrency(gameplayScope === 'today' ? todayLostCoins : totalLostCoins)}
              </div>
            )}
            <p className="text-[9px] text-muted-foreground/70 hidden sm:block">Net lost coins by players</p>
          </div>
        </div>
      </Card>

      {/* 🎰 Live Game Draw Monitor & Winning Numbers Feed (Multi-Game Architecture) */}
      <Card className="bg-card border-border/80 shadow-2xs rounded-2xl p-3 sm:p-4 space-y-3">
        {/* Card Header & Multi-Game Selector Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <Radio className="h-4 w-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm sm:text-base font-black tracking-tight text-foreground">
                  Live Game Draw Monitor
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Sync
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground font-semibold hidden sm:block">
                Real-time round outcome stream, 30s pre-determined winning number reveal, and draw timestamps.
              </p>
            </div>
          </div>

          {/* Multi-Game Tabs (Triple Chance + 2 Future Games Placeholders) */}
          <div className="flex items-center gap-1 bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] font-bold self-start sm:self-auto overflow-x-auto max-w-full">
            <button
              onClick={() => setSelectedGameTab('triple_chance')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center space-x-1 shrink-0 ${
                selectedGameTab === 'triple_chance'
                  ? 'bg-primary text-primary-foreground font-black shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>🎰 Triple Chance</span>
            </button>

            <button
              onClick={() => setSelectedGameTab('game_2')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer flex items-center space-x-1 shrink-0 ${
                selectedGameTab === 'game_2'
                  ? 'bg-primary text-primary-foreground font-black shadow-xs'
                  : 'text-muted-foreground/60 hover:text-muted-foreground'
              }`}
            >
              <span>🎲 Game 2</span>
              <span className="text-[8px] bg-secondary px-1 rounded text-muted-foreground">Soon</span>
            </button>

            <button
              onClick={() => setSelectedGameTab('game_3')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer flex items-center space-x-1 shrink-0 ${
                selectedGameTab === 'game_3'
                  ? 'bg-primary text-primary-foreground font-black shadow-xs'
                  : 'text-muted-foreground/60 hover:text-muted-foreground'
              }`}
            >
              <span>🃏 Game 3</span>
              <span className="text-[8px] bg-secondary px-1 rounded text-muted-foreground">Soon</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Triple Chance Active View */}
        {selectedGameTab === 'triple_chance' && (
          <div className="space-y-3">
            {(() => {
              // 30s UTC pre-determination calculation
              const utcSecs = Math.floor(nowTime / 1000)
              const cycleRem = 103 - (utcSecs % 103)
              const roundCountdown = cycleRem >= 14 ? cycleRem - 13 : 0
              const isPreDetermined30s = roundCountdown <= 30

              // PHASE 1: Loading State (90s down to 31s remaining)
              if (!isPreDetermined30s) {
                return (
                  <div className="p-4 sm:p-5 rounded-xl bg-gradient-to-r from-secondary/40 via-card to-background border border-border/80 space-y-3 shadow-inner">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center space-x-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Calculating Round Outcome... (Reveals at 30s remaining)</span>
                        </span>
                      </div>

                      <div className="flex items-center space-x-1.5 text-xs font-mono font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{roundCountdown}s remaining in betting phase</span>
                      </div>
                    </div>

                    {/* Animated Pulsing Digit Skeletons */}
                    <div className="flex items-center justify-between flex-wrap gap-3 pt-1 opacity-70">
                      <div className="flex items-center space-x-2 sm:space-x-3">
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-extrabold uppercase text-muted-foreground mb-1">Red (1st)</span>
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-red-950/20 border-2 border-red-500/40 text-red-400/50 flex items-center justify-center text-lg sm:text-2xl font-black font-mono animate-pulse">
                            ?
                          </div>
                        </div>

                        <span className="text-muted-foreground/30 font-black text-xl mt-4">+</span>

                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-extrabold uppercase text-muted-foreground mb-1">Green (2nd)</span>
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-950/20 border-2 border-emerald-500/40 text-emerald-400/50 flex items-center justify-center text-lg sm:text-2xl font-black font-mono animate-pulse">
                            ?
                          </div>
                        </div>

                        <span className="text-muted-foreground/30 font-black text-xl mt-4">+</span>

                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-extrabold uppercase text-muted-foreground mb-1">Black (3rd)</span>
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-neutral-900 border-2 border-neutral-700/50 text-muted-foreground/50 flex items-center justify-center text-lg sm:text-2xl font-black font-mono animate-pulse">
                            ?
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-start sm:items-end">
                        <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">3-Digit Result</span>
                        <div className="text-2xl sm:text-4xl font-black font-mono tracking-widest text-muted-foreground/40 bg-secondary/40 px-3 py-1 rounded-xl border border-border/50 mt-0.5 animate-pulse">
                          ???
                        </div>
                      </div>
                    </div>

                    <p className="text-[10px] text-muted-foreground font-semibold pt-1 border-t border-border/40">
                      💡 Players are placing bets. Pre-determined winning outcome will reveal automatically on Superadmin when timer hits 30 seconds.
                    </p>
                  </div>
                )
              }

              // PHASE 2: Revealed Real Winning Outcome (30s down to 0s & during spin)
              if (latestDraws.length > 0) {
                const latest = latestDraws[0]
                const drawTime = latest.createdAt ? new Date(latest.createdAt).getTime() : Date.now()
                const diffSecs = Math.max(0, Math.floor((nowTime - drawTime) / 1000))

                let relativeTimeStr = 'Just now'
                if (diffSecs >= 5 && diffSecs < 60) relativeTimeStr = `${diffSecs}s ago`
                else if (diffSecs >= 60 && diffSecs < 3600) relativeTimeStr = `${Math.floor(diffSecs / 60)}m ago`
                else if (diffSecs >= 3600) relativeTimeStr = `${Math.floor(diffSecs / 3600)}h ago`

                return (
                  <div className="p-3 sm:p-4 rounded-xl bg-gradient-to-r from-purple-950/30 via-card to-background border border-purple-500/30 space-y-3 shadow-inner">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse flex items-center space-x-1">
                          <Sparkles className="h-3 w-3" />
                          <span>⚡ Pre-Determined Result Revealed (30s Remaining)</span>
                        </span>
                      </div>

                      <div className="flex items-center space-x-1.5 text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{relativeTimeStr}</span>
                      </div>
                    </div>

                    {/* Color-Coded 3-Digit Winning Outcome Display */}
                    <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                      <div className="flex items-center space-x-2 sm:space-x-3">
                        {/* Red Digit (1st) */}
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-extrabold uppercase text-muted-foreground mb-1">Red (1st)</span>
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-red-600/20 border-2 border-red-500 text-red-400 flex items-center justify-center text-lg sm:text-2xl font-black font-mono shadow-md">
                            {latest.redDigit}
                          </div>
                        </div>

                        <span className="text-muted-foreground/40 font-black text-xl mt-4">+</span>

                        {/* Green Digit (2nd) */}
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-extrabold uppercase text-muted-foreground mb-1">Green (2nd)</span>
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-600/20 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center text-lg sm:text-2xl font-black font-mono shadow-md">
                            {latest.greenDigit}
                          </div>
                        </div>

                        <span className="text-muted-foreground/40 font-black text-xl mt-4">+</span>

                        {/* Black Digit (3rd) */}
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-extrabold uppercase text-muted-foreground mb-1">Black (3rd)</span>
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-neutral-800 border-2 border-neutral-600 text-foreground flex items-center justify-center text-lg sm:text-2xl font-black font-mono shadow-md">
                            {latest.blackDigit}
                          </div>
                        </div>
                      </div>

                      {/* Combination Result Badge */}
                      <div className="flex flex-col items-start sm:items-end">
                        <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">3-Digit Result</span>
                        <div className="text-2xl sm:text-4xl font-black font-mono tracking-widest text-primary bg-primary/10 px-3 py-1 rounded-xl border border-primary/30 mt-0.5">
                          {latest.resultNumber.toString().padStart(3, '0')}
                        </div>
                      </div>
                    </div>

                    {/* Round Financial Breakdown */}
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-purple-500/20 text-[10px] sm:text-xs">
                      <div>
                        <span className="text-muted-foreground font-semibold block">Player:</span>
                        <span className="font-extrabold font-mono text-foreground">@{latest.playerUsername}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground font-semibold block">Wagered:</span>
                        <span className="font-extrabold font-mono text-foreground">{formatCurrency(latest.betAmount)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground font-semibold block">Net Payout:</span>
                        <span className={`font-extrabold font-mono ${latest.winAmount > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                          {latest.winAmount > 0 ? `+${formatCurrency(latest.winAmount)}` : '0 Coins'}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              }

              return (
                <div className="p-4 rounded-xl bg-secondary/30 border border-border text-center text-xs text-muted-foreground">
                  No game draw records found. Plays made on Triple Chance will automatically show here in real-time.
                </div>
              )
            })()}

            {/* Recent Rounds Stream (Horizontal Chips Stream) */}
            {latestDraws.length > 1 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block">
                  Recent Draw Stream (Last 10 Rounds)
                </span>
                <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
                  {latestDraws.slice(1).map(draw => {
                    const drawTime = draw.createdAt ? new Date(draw.createdAt).getTime() : Date.now()
                    const diffSecs = Math.max(0, Math.floor((nowTime - drawTime) / 1000))
                    let relTime = 'Just now'
                    if (diffSecs >= 5 && diffSecs < 60) relTime = `${diffSecs}s ago`
                    else if (diffSecs >= 60 && diffSecs < 3600) relTime = `${Math.floor(diffSecs / 60)}m ago`
                    else if (diffSecs >= 3600) relTime = `${Math.floor(diffSecs / 3600)}h ago`

                    return (
                      <div
                        key={draw.id}
                        className="px-2.5 py-1.5 rounded-xl bg-secondary/40 border border-border/60 shrink-0 flex items-center space-x-2 text-xs font-mono"
                      >
                        <span className="text-[10px] text-muted-foreground font-semibold">{relTime}</span>
                        <div className="flex items-center space-x-1 font-bold">
                          <span className="text-red-400">{draw.redDigit}</span>
                          <span className="text-muted-foreground/50 text-[10px]">•</span>
                          <span className="text-emerald-400">{draw.greenDigit}</span>
                          <span className="text-muted-foreground/50 text-[10px]">•</span>
                          <span className="text-foreground">{draw.blackDigit}</span>
                        </div>
                        <span className="font-extrabold text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[11px] border border-primary/20">
                          {draw.resultNumber.toString().padStart(3, '0')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2 & 3: Future Games Placeholder Views */}
        {selectedGameTab !== 'triple_chance' && (
          <div className="p-6 text-center rounded-xl bg-secondary/20 border border-dashed border-border/80 space-y-2">
            <div className="inline-flex p-3 rounded-full bg-primary/10 text-primary border border-primary/20">
              <Dices className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-black text-foreground">
              {selectedGameTab === 'game_2' ? 'Game 2 (Coming Soon)' : 'Game 3 (Coming Soon)'}
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Multi-game architecture is ready. Live draw outcome feeds and round telemetry for this game will activate automatically upon release.
            </p>
          </div>
        )}
      </Card>

      {/* Main Widgets: RTP Configuration & Recent System Logs */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* RTP Configuration Card (md:col-span-5) */}
        <Card className="md:col-span-5 bg-card border-border/80 shadow-md rounded-2xl p-3.5 sm:p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Settings2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground leading-tight">RTP Configuration</h3>
                <p className="text-[10px] text-muted-foreground">Adjust payout rates across slots & games.</p>
              </div>
            </div>
            <span className="font-mono font-black text-amber-500 text-lg bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
              {rtpValue}%
            </span>
          </div>

          {isLoadingMetrics ? (
            <div className="space-y-3 p-2 animate-pulse">
              <div className="h-4 bg-secondary/80 rounded w-full" />
              <div className="h-8 bg-secondary/60 rounded w-full" />
            </div>
          ) : (
            <div className="space-y-3.5">
              {rtpSuccess && (
                <div className="p-2 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20 flex items-center space-x-1.5">
                  <Check className="h-3.5 w-3.5 text-success-text shrink-0" />
                  <span>{rtpSuccess}</span>
                </div>
              )}

              {/* Slider Controls */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-[10px] font-mono font-bold">
                  <span className="text-muted-foreground">Adjust Target RTP</span>
                  <span className="text-amber-500 font-black">{rtpValue}%</span>
                </div>
                <Slider 
                  value={[rtpValue]}
                  onValueChange={(val) => {
                    if (typeof val === 'number') {
                      setRtpValue(val)
                    } else if (Array.isArray(val) && typeof val[0] === 'number') {
                      setRtpValue(val[0])
                    }
                  }}
                  max={99} 
                  min={50} 
                  step={0.5}
                  className="w-full cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                  <span>50% (Max House Margin)</span>
                  <span>99% (Min House Margin)</span>
                </div>
              </div>

              {/* Preset Quick Pills */}
              <div className="space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Quick Presets
                </span>
                <div className="flex items-center flex-wrap gap-1.5">
                  {[
                    { val: 90, label: '90% Aggressive' },
                    { val: 92.5, label: '92.5% Medium' },
                    { val: 95, label: '95% Balanced' },
                    { val: 96.5, label: '96.5% Standard' },
                    { val: 98, label: '98% High Payout' }
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      onClick={() => handleApplyRtp(preset.val)}
                      disabled={isSavingRtp}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-black transition-all cursor-pointer border ${
                        rtpValue === preset.val
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-secondary/40 text-muted-foreground border-border/60 hover:text-foreground hover:bg-secondary'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live House Edge & Payout Yield Breakdown Box */}
              <div className="p-3 rounded-xl bg-secondary/30 border border-border/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Yield Rating & Margin
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black uppercase ${
                    rtpValue < 92
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : rtpValue <= 96.5
                      ? 'bg-success-bg text-success-text border border-emerald-500/30'
                      : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {rtpValue < 92 ? '🔥 Aggressive Yield' : rtpValue <= 96.5 ? '⚖️ Balanced (Recommended)' : '💎 Player Friendly'}
                  </span>
                </div>

                {/* Visual Ratio Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono font-bold">
                    <span className="text-emerald-400">Player Return: {rtpValue}%</span>
                    <span className="text-amber-400">House Edge: {(100 - rtpValue).toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-amber-500/20 overflow-hidden flex">
                    <div 
                      className="h-full bg-emerald-500 transition-all duration-300 rounded-l-full" 
                      style={{ width: `${rtpValue}%` }} 
                    />
                    <div 
                      className="h-full bg-amber-500 transition-all duration-300 rounded-r-full" 
                      style={{ width: `${(100 - rtpValue).toFixed(1)}%` }} 
                    />
                  </div>
                </div>

                {/* Simulated 1,000 Wager Turnover */}
                <div className="grid grid-cols-2 gap-2 pt-1 text-center text-[10px] font-mono">
                  <div className="p-1.5 rounded-lg bg-card border border-border/40">
                    <span className="text-muted-foreground block text-[9px] uppercase font-bold">Est. Player Payout (1k Coins)</span>
                    <span className="font-black text-emerald-400 text-xs">{(1000 * (rtpValue / 100)).toFixed(0)} Coins</span>
                  </div>
                  <div className="p-1.5 rounded-lg bg-card border border-border/40">
                    <span className="text-muted-foreground block text-[9px] uppercase font-bold">Est. House Profit (1k Coins)</span>
                    <span className="font-black text-amber-400 text-xs">{(1000 * ((100 - rtpValue) / 100)).toFixed(0)} Coins</span>
                  </div>
                </div>
              </div>

              <Button 
                onClick={() => handleApplyRtp()} 
                disabled={isSavingRtp}
                className="w-full h-9 font-extrabold text-xs cursor-pointer bg-primary text-primary-foreground hover:bg-primary/95 rounded-xl shadow-xs"
              >
                {isSavingRtp ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {isSavingRtp ? 'Saving Configuration...' : 'Apply Configuration'}
              </Button>
            </div>
          )}
        </Card>

        {/* Recent System Logs Widget (md:col-span-7) */}
        <Card className="md:col-span-7 bg-card border-border/80 shadow-md rounded-2xl p-3.5 sm:p-4 space-y-3">
          {/* Header Bar + Log Filters & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-border/60 pb-2.5">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground leading-tight">Recent System Logs</h3>
                <p className="text-[10px] text-muted-foreground">Live administrative audit trail.</p>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] font-bold">
              {(['ALL', 'System', 'Transaction', 'Security'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setLogCategory(cat)}
                  className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer uppercase ${
                    logCategory === cat ? 'bg-primary text-primary-foreground font-black' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground/70" />
            <Input 
              placeholder="Search audit logs..." 
              value={logSearchQuery}
              onChange={(e) => setLogSearchQuery(e.target.value)}
              className="pl-9 h-8 bg-card border-border/80 text-foreground text-xs rounded-xl focus:border-primary/50 shadow-xs" 
            />
            {logSearchQuery && (
              <button 
                onClick={() => setLogSearchQuery('')}
                className="absolute right-3 top-2 text-[10px] text-muted-foreground hover:text-foreground font-bold"
              >
                Clear
              </button>
            )}
          </div>

          {/* Logs List Container */}
          <div>
            {isLoadingMetrics ? (
              <div className="space-y-2.5 p-1">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-4 p-2.5 rounded-xl bg-secondary/20 animate-pulse border border-border/40">
                    <div className="h-3.5 bg-secondary/80 rounded w-2/3" />
                    <div className="h-3.5 bg-secondary/60 rounded w-1/6" />
                  </div>
                ))}
              </div>
            ) : paginatedLogs.length > 0 ? (
              <div className="space-y-2 min-h-[190px]">
                {paginatedLogs.map((log) => (
                  <div key={log.id} className="relative pl-6 flex items-center justify-between gap-3 p-2 rounded-xl bg-secondary/20 border border-border/40 hover:bg-secondary/40 transition-colors">
                    <span className="absolute left-2 top-3 w-2 h-2 rounded-full border border-card bg-background flex items-center justify-center">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        log.type.toUpperCase() === 'SECURITY' ? 'bg-red-500' :
                        log.type.toUpperCase() === 'SYSTEM' ? 'bg-emerald-500' : 'bg-blue-500'
                      }`} />
                    </span>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs font-bold text-foreground truncate">
                        {log.detail}
                      </p>
                      <span className="text-[10px] font-mono text-muted-foreground block">{log.time}</span>
                    </div>

                    <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black uppercase tracking-wider shrink-0 ${
                      log.type.toUpperCase() === 'SECURITY' ? 'bg-danger-bg text-danger-text border border-red-500/20' :
                      log.type.toUpperCase() === 'SYSTEM' ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-info-bg text-info-text border border-blue-500/20'
                    }`}>
                      {log.type}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground font-medium">
                No system logs found matching the selected filter.
              </div>
            )}

            {/* Pagination for Logs */}
            {filteredLogs.length > logsPerPage && (
              <div className="pt-2 border-t border-border/60">
                <ResponsivePagination 
                  currentPage={logPage}
                  totalPages={Math.ceil(filteredLogs.length / logsPerPage)}
                  onPageChange={setLogPage}
                  totalItems={filteredLogs.length}
                  itemsPerPage={logsPerPage}
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
