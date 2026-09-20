"use client"

import * as React from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Users, Coins, Percent, ShieldCheck, TrendingUp, TrendingDown, RefreshCw, ArrowUpRight, ArrowDownRight, Search, Gamepad2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResponsivePagination } from '@/components/responsive-pagination'
import { ErrorBanner } from '@/components/error-banner'
import { getRtpAction, getAuditLogsAction, getSystemOverviewMetricsAction } from './actions'
import { formatCurrency } from '@/lib/utils'
import { useLiveSync } from '@/hooks/use-live-sync'
import { LiveSyncBadge } from '@/components/live-sync-badge'
import { useRequestGeneration } from '@/hooks/use-request-generation'

export default function SuperAdminDashboard() {
  const [rtpValue, setRtpValue] = React.useState(96.5)
  const [todayDeposited, setTodayDeposited] = React.useState(0)
  const [todayWithdrawn, setTodayWithdrawn] = React.useState(0)
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

  const [systemLogs, setSystemLogs] = React.useState<Array<{ id: string; kind: string; detail: string; time: string; actor: string }>>([])
  // Issue #15: surfaces a real backend failure instead of silently leaving
  // this page showing all-zero KPIs indistinguishable from genuinely-empty
  // data. Combines all 3 of fetchMetrics' actions -- any of them failing
  // still shows an error, while whichever ones succeeded still update state
  // normally (partial degradation, not an all-or-nothing wipeout).
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isLoadingMetrics, setIsLoadingMetrics] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  // rtpValue itself stays (the "Global RTP Target" KPI tile below reads it)
  // -- but the editable RTP Configuration widget, the Bonus Multiplier
  // widget, and their shared round-lock countdown (isSavingRtp/rtpSuccess/
  // bonusMultiplier/isSavingBonusMultiplier/bonusMultiplierSuccess/
  // roundSecondsInto/displayCountdown/roundConfigLocked) all moved to
  // /superadmin/live-game's Triple Chance tab 2026-09-20 (Issue #97) --
  // they're Triple-Chance-specific game settings, not general dashboard
  // state, and now live next to that game's own live monitor.
  // Guards fetchMetrics against out-of-order responses -- this page has 3
  // independent triggers into it (live sync, manual refresh, and a
  // successful RTP change), the most of any page audited.
  const metricsRequest = useRequestGeneration()

  // Log Filter, Search & Pagination states
  const [logCategory, setLogCategory] = React.useState<'ALL' | 'System' | 'Transaction' | 'Security'>('ALL')
  const [logSearchQuery, setLogSearchQuery] = React.useState('')
  const [logPage, setLogPage] = React.useState(1)
  const logsPerPage = 4
  // Housekeeping #92 fix: tracks the last-seen filter values so the page
  // number can be corrected during render itself -- React's own recommended
  // pattern for "adjust state when a dependency changes" -- instead of a
  // useEffect, which would draw one wrong frame before fixing itself a
  // render later. The actual comparison/correction lives further down,
  // right before the JSX return.
  const [lastLogFilters, setLastLogFilters] = React.useState<[typeof logCategory, string]>([logCategory, logSearchQuery])

  // Returned (not fire-and-forget) so useLiveSync can await it and skip
  // starting an overlapping poll tick while this one is still in flight --
  // see the in-flight guard in use-live-sync.ts (Issue #93).
  const fetchMetrics = React.useCallback(() => {
    const token = metricsRequest.nextGeneration()
    return Promise.all([
      getSystemOverviewMetricsAction(),
      getRtpAction(),
      getAuditLogsAction()
    ]).then(([resMetrics, resRtp, resLogs]) => {
      if (!metricsRequest.isCurrent(token)) return
      setIsLoadingMetrics(false)
      setIsRefreshing(false)
      const errors = [resMetrics.error, resRtp.error, resLogs.error].filter(Boolean)
      setLoadError(errors.length > 0 ? errors.join(' — ') : null)
      if (resMetrics && !resMetrics.error) {
        setTodayDeposited(resMetrics.today_deposited || 0)
        setTodayWithdrawn(resMetrics.today_withdrawn || 0)
        setActiveAgents(resMetrics.active_agents || 0)
        setActivePlayers(resMetrics.active_players || 0)
        setTotalBetsCount(resMetrics.lifetime_bets || 0)
        setTotalBetCoins(resMetrics.lifetime_stake || 0)
        setTotalWinCoins(resMetrics.lifetime_payout || 0)
        setTotalLostCoins(resMetrics.lifetime_house || 0)
        setTodayBetsCount(resMetrics.today_bets || 0)
        setTodayBetCoins(resMetrics.today_stake || 0)
        setTodayWinCoins(resMetrics.today_payout || 0)
        setTodayLostCoins(resMetrics.today_house || 0)
      }
      // resRtp.rtp is a truthy 96 even on error (its own hardcoded fallback),
      // so this must check .error explicitly -- a bare truthy check on rtp
      // would silently apply that fallback as if it were the real value.
      if (resRtp && !resRtp.error && resRtp.rtp) {
        setRtpValue(resRtp.rtp)
      }
      if (resLogs && !resLogs.error) {
        setSystemLogs(resLogs.logs)
      }
    }).catch((e) => {
      if (!metricsRequest.isCurrent(token)) return
      setIsLoadingMetrics(false)
      setIsRefreshing(false)
      setLoadError(e instanceof Error ? e.message : 'Could not load dashboard data.')
    })
  }, [metricsRequest])

  // Issue #93 bug fix: calls useLiveSync's own guarded refresh() instead of
  // fetchMetrics directly -- a direct call bypassed the in-flight guard
  // entirely, confirmed live to leave this button stuck spinning 24+
  // seconds straight (this page's 3-action Promise.all is heavy enough to
  // regularly approach the 10s poll interval).
  const handleManualRefresh = () => {
    setIsRefreshing(true)
    refresh() // cleared by fetchMetrics' own completion above
  }

  // Issue #91 addendum (2026-08-25): replaces the old direct useLiveVersion
  // effect. useLiveSync keeps the same Realtime-driven fast path (the shared
  // connection from LiveDataProvider, mounted once in superadmin/layout.tsx
  // -- still usually well under a second when Realtime is actually
  // delivering) but adds a guaranteed poll backstop instead of the old 90s
  // one -- see MASTER_AUDIT_AND_REMEDIATION_PLAN.md Issue #91: Realtime's own
  // "SUBSCRIBED"/connected status was proven able to stay true for an entire
  // session while every event silently failed a server-side authorization
  // check, with zero client-visible signal. Tier 'normal' (10s, not the 3s
  // 'fast' tier) since getSystemOverviewMetricsAction does full-table scans
  // (profiles/coin_ledger/bets, unfiltered) -- this is a summary view, not a
  // live-gameplay-outcome page, so the heavier query cost gets a longer
  // interval. Matches getSystemOverviewMetricsAction's actual query scope,
  // re-verified by reading the live action body. Note: getAuditLogsAction
  // reads audit_log, which is not in the Realtime publication (out of scope
  // since Issue #91's original design) -- the audit log list on this page
  // still only refreshes on this same poll or a manual refresh, never on its
  // own real-time events.
  const { lastSyncedAt, tierMs, refresh } = useLiveSync(['profiles', 'bets', 'coin_ledger'], fetchMetrics, 'normal')

  // Filtered & Paginated Logs
  const filteredLogs = React.useMemo(() => {
    return systemLogs.filter(log => {
      if (logCategory !== 'ALL' && log.kind.toUpperCase() !== logCategory.toUpperCase()) {
        return false
      }
      if (logSearchQuery.trim()) {
        const query = logSearchQuery.toLowerCase()
        return log.detail.toLowerCase().includes(query) || log.kind.toLowerCase().includes(query)
      }
      return true
    })
  }, [systemLogs, logCategory, logSearchQuery])

  const paginatedLogs = React.useMemo(() => {
    const start = (logPage - 1) * logsPerPage
    return filteredLogs.slice(start, start + logsPerPage)
  }, [filteredLogs, logPage])

  // Reset page when log filter changes -- corrected during render (see
  // lastLogFilters above), not in an effect.
  if (lastLogFilters[0] !== logCategory || lastLogFilters[1] !== logSearchQuery) {
    setLastLogFilters([logCategory, logSearchQuery])
    setLogPage(1)
  }

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto px-2 sm:px-4 md:px-0 pb-12">
      <ErrorBanner error={loadError} />

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
          <LiveSyncBadge lastSyncedAt={lastSyncedAt} tierMs={tierMs} />
          <Button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            variant="outline"
            size="sm"
            className="h-7.5 sm:h-8 text-[11px] sm:text-xs font-extrabold px-2.5 sm:px-3 rounded-xl border-border/80 hover:bg-secondary cursor-pointer shrink-0 w-auto"
          >
            <RefreshCw className={`mr-1 sm:mr-1.5 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Top Overview Micro Cards (2-Column on Mobile, 4-Column on Larger) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-3">
        {/* Card 1: Today Deposited -- coins actually SENT to agents today (never netted against withdrawals) */}
        <Link href="/superadmin/agents/issued" className="block cursor-pointer group">
          <Card className="bg-card border-border/80 shadow-2xs rounded-xl p-2 sm:p-3 group-hover:border-primary/50 group-hover:shadow-md transition-all duration-200 h-full">
            <div className="flex items-center justify-between">
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors truncate">
                Today Deposited
              </span>
              <div className="p-1 sm:p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white transition-colors shrink-0 hidden sm:block">
                <Coins className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
            </div>
            <div className="mt-0.5 sm:mt-1.5">
              {isLoadingMetrics ? (
                <div className="h-5 sm:h-6 w-14 sm:w-20 bg-secondary/80 animate-pulse rounded my-0.5" />
              ) : (
                <div className="text-xs sm:text-2xl font-black font-mono tracking-tight text-emerald-500 flex items-center justify-between">
                  <span className="truncate">+{formatCurrency(todayDeposited)}</span>
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

        {/* Card 2: Today Withdrawn -- coins actually TAKEN BACK from agents today */}
        <Link href="/superadmin/agents/issued" className="block cursor-pointer group">
          <Card className="bg-card border-border/80 shadow-2xs rounded-xl p-2 sm:p-3 group-hover:border-primary/50 group-hover:shadow-md transition-all duration-200 h-full">
            <div className="flex items-center justify-between">
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors truncate">
                Today Withdrawn
              </span>
              <div className="p-1 sm:p-1.5 rounded-lg bg-amber-500/10 text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-colors shrink-0 hidden sm:block">
                <Coins className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
            </div>
            <div className="mt-0.5 sm:mt-1.5">
              {isLoadingMetrics ? (
                <div className="h-5 sm:h-6 w-14 sm:w-20 bg-secondary/80 animate-pulse rounded my-0.5" />
              ) : (
                <div className="text-xs sm:text-2xl font-black font-mono tracking-tight text-amber-500 flex items-center justify-between">
                  <span className="truncate">{formatCurrency(todayWithdrawn)}</span>
                  <ArrowDownRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 group-hover:translate-y-0.5 transition-all shrink-0 hidden sm:block" />
                </div>
              )}
              <div className="flex items-center space-x-1 mt-0.5 text-[8px] sm:text-[10px]">
                <TrendingDown className="h-2.5 w-2.5 text-amber-500 shrink-0 hidden sm:block" />
                <span className="text-amber-500 font-extrabold truncate">Resets 00:00 IST</span>
              </div>
            </div>
          </Card>
        </Link>

        {/* Card 3: Active Network */}
        <Card className="bg-card border-border/80 shadow-2xs rounded-xl p-2 sm:p-3 transition-all duration-200">
          <div className="flex items-center justify-between">
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">Network</span>
            <div className="p-1 sm:p-1.5 rounded-lg bg-blue-500/10 text-blue-500 shrink-0 hidden sm:block">
              <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="mt-0.5 sm:mt-1.5">
            {isLoadingMetrics ? (
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

        {/* Card 4: Global RTP Target */}
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
            {isLoadingMetrics ? (
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
            {isLoadingMetrics ? (
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
            {isLoadingMetrics ? (
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
            {isLoadingMetrics ? (
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



      {/* Recent System Logs Widget. RTP Configuration and Bonus Multiplier
          (Issue #96/#97) were relocated to /superadmin/live-game's Triple
          Chance tab 2026-09-20 -- they're Triple-Chance-specific game
          settings, so they now live next to that game's own live monitor
          instead of the general dashboard. This card no longer needs a
          12-column grid partner, so it's full width now instead of
          md:col-span-7. rtpValue/getRtpAction stay on THIS page -- the
          "Global RTP Target" KPI tile above still reads it. */}
        <Card className="bg-card border-border/80 shadow-md rounded-2xl p-3.5 sm:p-4 space-y-3">
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
                        log.kind.toUpperCase() === 'SECURITY' ? 'bg-red-500' :
                        log.kind.toUpperCase() === 'SYSTEM' ? 'bg-emerald-500' : 'bg-blue-500'
                      }`} />
                    </span>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs font-bold text-foreground truncate">
                        {log.detail}
                      </p>
                      <span className="text-[10px] font-mono text-muted-foreground block">{log.time}</span>
                    </div>

                    <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black uppercase tracking-wider shrink-0 ${
                      log.kind.toUpperCase() === 'SECURITY' ? 'bg-danger-bg text-danger-text border border-red-500/20' :
                      log.kind.toUpperCase() === 'SYSTEM' ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-info-bg text-info-text border border-blue-500/20'
                    }`}>
                      {log.kind}
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
  )
}
