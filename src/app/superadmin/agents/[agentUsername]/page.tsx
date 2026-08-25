"use client"

import * as React from 'react'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Users, Coins, Activity, CalendarIcon, ArrowUpRight, ArrowDownRight, Loader2, UserX, UserCheck, Key, Eye, EyeOff, Gamepad2, X, RefreshCw, TrendingUp, CheckCircle2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { pickedDayKey } from "@/lib/date-range"
import { playerStatus } from "@/lib/player-status"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { ErrorBanner } from "@/components/error-banner"
import type { PlayerProfitRow } from '@/app/agent/profit/actions'
import type { PlayerGamePlay, PlayerCoinMovement } from '@/app/agent/players/actions'
import { GamePlayDetailDialog } from "@/components/game-play-detail-dialog"
import { useLiveSync } from "@/hooks/use-live-sync"
import { LiveSyncBadge } from "@/components/live-sync-badge"
import { useRequestGeneration } from "@/hooks/use-request-generation"
import { getAgentDetailBundleAction, issueAgentCoinsAction, setAgentActiveAction, updateAgentPasswordAction } from '../actions'
import { getPlayerDetailHistoryAction } from '@/app/agent/players/actions'

interface Props {
  params: React.Usable<{ agentUsername: string }>
}

export default function AgentDetailPage({ params }: Props) {
  const { agentUsername } = React.use(params)
  const resolvedAgentIdRef = React.useRef<string>('') // UUID resolved from username by server action
  
  const [agentInfo, setAgentInfo] = React.useState<{
    id: string
    full_name: string
    username: string
    coin_balance: number
    is_active: boolean
    auto_locked_at: string | null
    joined_date: string
  } | null>(null)
  const [players, setPlayers] = React.useState<Array<{
    id: string
    full_name: string
    username: string
    coin_balance: number
    is_active: boolean
    is_online: boolean
    auto_locked_at: string | null
  }>>([])
  const [selectedPlayer, setSelectedPlayer] = React.useState<typeof players[0] | null>(null)
  // Issue #15: for the page's own data load (loadAgentDetails/loadPlayerHistory)
  // -- distinct from transferError/toggleStatusError/passwordError above,
  // which are each scoped to their own specific mutation.
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [showMobileDetail, setShowMobileDetail] = React.useState(false)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  // Guards loadAgentDetails against out-of-order responses -- this page has
  // 3 independent triggers into it (live sync, filter/scope change, manual
  // refresh), the most of any page audited.
  const agentDetailsRequest = useRequestGeneration()
  // Stable refs — avoid interval leaks caused by state deps in useCallback
  const selectedPlayerIdRef = React.useRef<string | null>(null)
  // Issue #90 fix: stores the resolved IST day key (e.g. "2026-08-15"), not a
  // Date -- see filterDate below for why.
  const filterDateRef = React.useRef<string | undefined>(undefined)
  const statsScopeRef = React.useRef<'today' | 'lifetime'>('today')
  const isInitialMountRef = React.useRef(true)

  const [gamePlays, setGamePlays] = React.useState<PlayerGamePlay[]>([])
  const [pointsHistory, setPointsHistory] = React.useState<PlayerCoinMovement[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<'games' | 'points' | 'profit'>('games')
  const [profitSummary, setProfitSummary] = React.useState({ todays_profit: 0, lifetime_profit: 0, total_stake: 0, total_payout: 0, margin_pct: 0 })
  const [profitPlayers, setProfitPlayers] = React.useState<PlayerProfitRow[]>([])
  
  // Filter & Scope States
  const [statsScope, setStatsScope] = React.useState<'today' | 'lifetime'>('today')
  // Issue #90 fix: filterDate is a plain IST day key ("2026-08-15"), not a
  // Date object. Both places that can set it -- the Calendar picker (via
  // pickedDayKey, a local-frame read with no timezone conversion) and the
  // "Today" quick-button (via toLocaleDateString(...,{timeZone:'Asia/Kolkata'}),
  // a genuine instant that DOES need timezone-aware conversion) -- resolve to
  // the same kind of trusted value at the point each one is set, so nothing
  // downstream can accidentally apply the wrong conversion to the wrong kind
  // of origin the way a shared Date + single downstream conversion could.
  const [filterDate, setFilterDate] = React.useState<string | undefined>(undefined)
  const [filterOutcome, setFilterOutcome] = React.useState<'all' | 'WON' | 'LOST'>('all')
  const [filterMode, setFilterMode] = React.useState<'all' | 'SINGLE' | 'DOUBLE' | 'TRIPLE'>('all')

  // Point transfer modal state
  const [activeTransferModal, setActiveTransferModal] = React.useState<'deposit' | 'withdraw' | null>(null)
  const [transferAmount, setTransferAmount] = React.useState('')
  const [transferReason, setTransferReason] = React.useState('')
  const [isTransferring, setIsTransferring] = React.useState(false)
  const [transferError, setTransferError] = React.useState<string | null>(null)
  const [transferSuccess, setTransferSuccess] = React.useState<string | null>(null)

  // Status toggle state
  const [isTogglingStatus, setIsTogglingStatus] = React.useState(false)
  const [toggleStatusError, setToggleStatusError] = React.useState<string | null>(null)

  // Password reset modal state
  const [isPasswordModalOpen, setIsPasswordModalOpen] = React.useState(false)
  const [newPassword, setNewPassword] = React.useState('')
  const [isUpdatingPassword, setIsUpdatingPassword] = React.useState(false)
  const [passwordError, setPasswordError] = React.useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)

  const [gamesPage, setGamesPage] = React.useState(1)
  const [pointsPage, setPointsPage] = React.useState(1)
  const itemsPerPage = 5
  // Housekeeping #87 fix: tracks the last-seen filter values so pagination
  // can be corrected during render itself -- React's own recommended
  // pattern for "adjust state when a dependency changes" -- instead of an
  // effect, which draws one wrong frame before fixing itself a render later.
  const [lastFilters, setLastFilters] = React.useState<[string | undefined, typeof filterOutcome, typeof filterMode]>([filterDate, filterOutcome, filterMode])

  // Reset pagination when filters change -- corrected during render (see
  // lastFilters above), not in an effect.
  if (lastFilters[0] !== filterDate || lastFilters[1] !== filterOutcome || lastFilters[2] !== filterMode) {
    setLastFilters([filterDate, filterOutcome, filterMode])
    setGamesPage(1)
    setPointsPage(1)
  }

  // Compute performance metrics
  const performanceStats = React.useMemo(() => {
    const todayIstStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // 'YYYY-MM-DD'

    const targetPlays = gamePlays.filter(spin => {
      if (statsScope === 'today') {
        if (spin.created_at_iso) {
          const spinIstStr = new Date(spin.created_at_iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
          return spinIstStr === todayIstStr
        }
        return true
      }
      return true
    })

    const totalPlays = targetPlays.length
    const totalBet = targetPlays.reduce((sum, p) => sum + p.total_stake, 0)
    const totalWin = targetPlays.reduce((sum, p) => sum + p.total_payout, 0)
    const netGgr = totalBet - totalWin
    const marginPct = totalBet > 0 ? (netGgr / totalBet) * 100 : 0

    return { totalPlays, totalBet, totalWin, netGgr, marginPct }
  }, [gamePlays, statsScope])

  // Filtered games list
  const filteredGames = React.useMemo(() => {
    return gamePlays.filter(spin => {
      // Date Filter -- Issue #90 fix: filterDate is already the resolved IST
      // day key, no conversion needed here anymore.
      if (filterDate) {
        const spinDateStr = spin.created_at_iso
          ? new Date(spin.created_at_iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
          : spin.created_at
        if (spinDateStr !== filterDate) return false
      }

      // Outcome Filter
      if (filterOutcome !== 'all' && spin.outcome !== filterOutcome) {
        return false
      }

      // Mode Filter
      if (filterMode !== 'all' && !spin.mode.toUpperCase().includes(filterMode)) {
        return false
      }

      return true
    })
  }, [gamePlays, filterDate, filterOutcome, filterMode])

  // Filtered points history list
  const filteredPoints = React.useMemo(() => {
    return pointsHistory.filter(tx => {
      // Issue #90 fix: same as filteredGames above -- filterDate is already
      // the resolved IST day key.
      if (filterDate) {
        const txDateStr = tx.created_at_iso
          ? new Date(tx.created_at_iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
          : tx.created_at
        if (txDateStr !== filterDate) return false
      }
      return true
    })
  }, [pointsHistory, filterDate])

  const paginatedGames = React.useMemo(() => {
    const start = (gamesPage - 1) * itemsPerPage
    return filteredGames.slice(start, start + itemsPerPage)
  }, [filteredGames, gamesPage])

  const paginatedPoints = React.useMemo(() => {
    const start = (pointsPage - 1) * itemsPerPage
    return filteredPoints.slice(start, start + itemsPerPage)
  }, [filteredPoints, pointsPage])

  // Tracks which player's history is currently loaded on screen. Reset
  // (page 1 + loading skeleton) only fires when this call is for a
  // *different* player than what's already loaded -- a genuine switch, not a
  // background refresh of the same player's data. See the identical fix on
  // agent/players/[[...slug]]/page.tsx (Issue #91 Phase 2) for the full
  // rationale -- previously reset unconditionally on every call.
  const loadedHistoryPlayerIdRef = React.useRef<string | null>(null)
  // Guards against an older, slower response overwriting a newer one -- see
  // the identical fix on agent/players/[[...slug]]/page.tsx.
  const historyRequest = useRequestGeneration()

  // Issue #93: extracted out of loadPlayerHistory so the SAME apply logic
  // (loadedHistoryPlayerIdRef bookkeeping, no pagination/skeleton reset for a
  // same-player background refresh) also covers history that arrives bundled
  // inside loadAgentDetails's getAgentDetailBundleAction response, not just
  // history fetched by loadPlayerHistory's own standalone call.
  const applyHistoryResult = React.useCallback((playerId: string, res: {
    game_plays: PlayerGamePlay[]
    coin_movements: PlayerCoinMovement[]
    error: string | null
  }) => {
    loadedHistoryPlayerIdRef.current = playerId
    setIsLoadingHistory(false)
    setLoadError(res.error)
    if (!res.error) {
      setGamePlays(res.game_plays)
      setPointsHistory(res.coin_movements)
    }
  }, [])

  const loadPlayerHistory = React.useCallback((playerId: string) => {
    const isSwitchingPlayer = loadedHistoryPlayerIdRef.current !== playerId
    if (isSwitchingPlayer) {
      setIsLoadingHistory(true)
      setGamesPage(1)
      setPointsPage(1)
    }
    const token = historyRequest.nextGeneration()
    getPlayerDetailHistoryAction(playerId).then((res) => {
      if (!historyRequest.isCurrent(token)) return
      applyHistoryResult(playerId, res)
    }).catch((e) => {
      if (!historyRequest.isCurrent(token)) return
      setIsLoadingHistory(false)
      setLoadError(e instanceof Error ? e.message : 'Could not load player history.')
    })
  }, [historyRequest, applyHistoryResult])

  // Housekeeping #87 fix: no longer takes a "show the refresh spinner" flag
  // -- that branch was never true from any of the 3 effect-triggered call
  // sites below (all passed false), but its mere presence meant any direct
  // call from an effect got flagged (react-hooks/set-state-in-effect), since
  // React can't statically prove which branch runs. Spinner control now
  // lives only in handleManualRefresh, the one place it's actually used.
  const loadAgentDetails = React.useCallback((opts?: { reloadHistory?: boolean }) => {
    const reloadHistory = opts?.reloadHistory ?? false
    const token = agentDetailsRequest.nextGeneration()
    const targetId = selectedPlayerIdRef.current
    // Issue #93: agent detail + profit report + (when relevant) the already-
    // selected player's history now come back from ONE combined action/
    // requireAuth() call instead of 2-3 separate ones. History is only asked
    // for when the caller wants a reload AND a player is already selected --
    // same condition the old separate loadPlayerHistory(updated.id) call
    // below used to gate on, preserving the original "a filter/scope-only
    // change never refetches history" behavior.
    const historyTargetId = reloadHistory ? targetId ?? undefined : undefined
    // Shares historyRequest's generation counter with loadPlayerHistory (the
    // manual-click path) so a newer manual player switch always wins over a
    // slower, now-stale bundle response, regardless of which resolves first.
    const historyToken = historyTargetId ? historyRequest.nextGeneration() : null

    getAgentDetailBundleAction(
      agentUsername,
      {
        datePreset: statsScopeRef.current,
        // Issue #90 fix: filterDateRef is already the resolved IST day key.
        filterDate: filterDateRef.current,
      },
      historyTargetId
    ).then((res) => {
      if (!agentDetailsRequest.isCurrent(token)) return
      setIsRefreshing(false)
      const errors = [res.error, res.profit.error, historyTargetId ? res.history.error : null].filter(Boolean)
      setLoadError(errors.length > 0 ? errors.join(' — ') : null)
      if (res.agent) setAgentInfo(res.agent)
      // Store the resolved UUID so other actions (transfer, toggle, password) can use it.
      // Housekeeping #28 fix: this used to also have a dead `else if
      // (res.agent?.id)` branch re-testing the identical condition this
      // line already tests -- unreachable, since nothing between the two
      // checks could change res.agent.id. Removed; behavior is unchanged.
      if (res.agent?.id) resolvedAgentIdRef.current = res.agent.id
      if (!res.error && res.players) {
        setPlayers(res.players)
        if (targetId) {
          const updated = res.players.find(p => p.id === targetId)
          if (updated) {
            setSelectedPlayer(updated)
            if (historyTargetId && historyToken !== null && historyRequest.isCurrent(historyToken)) {
              applyHistoryResult(updated.id, res.history)
            }
          }
        } else if (res.players.length > 0) {
          // First load, nothing selected yet -- which player is "first" isn't
          // known until this response comes back, so this one-time case still
          // needs its own follow-up fetch rather than being bundled above.
          selectedPlayerIdRef.current = res.players[0].id
          setSelectedPlayer(res.players[0])
          loadPlayerHistory(res.players[0].id)
        }
      }
      if (!res.profit.error) {
        setProfitSummary(res.profit.summary)
        setProfitPlayers(res.profit.players)
      }
    }).catch((e) => {
      if (!agentDetailsRequest.isCurrent(token)) return
      setIsRefreshing(false)
      setLoadError(e instanceof Error ? e.message : 'Could not load agent details.')
    })
  }, [agentUsername, loadPlayerHistory, applyHistoryResult, agentDetailsRequest, historyRequest])

  // Keep filter refs in sync so stable loadAgentDetails always reads latest values
  React.useEffect(() => {
    filterDateRef.current = filterDate
    statsScopeRef.current = statsScope
    // Skip the initial mount — main effect below handles it
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false
      return
    }
    // Re-fetch profit report whenever user changes date/scope filter
    loadAgentDetails({ reloadHistory: false })
  }, [filterDate, statsScope, loadAgentDetails])

  // Issue #91 addendum (2026-08-25): replaces the old direct useLiveVersion
  // effect. useLiveSync keeps the same Realtime-driven fast path (the shared
  // connection from LiveDataProvider, mounted once in superadmin/layout.tsx
  // -- still usually well under a second when Realtime is actually
  // delivering) but adds a guaranteed 3s poll backstop instead of the old
  // 90s one. Realtime's own "SUBSCRIBED"/connected status was proven able to
  // stay true for an entire session while every event silently failed a
  // server-side authorization check, with zero client-visible signal -- this
  // is the exact page that was live-tested when that was found. See
  // MASTER_AUDIT_AND_REMEDIATION_PLAN.md Issue #91 for the full evidence.
  // Tier 'fast' (3s, not the 10s 'normal' tier) since this page shows live
  // gameplay outcomes for an agent's own players, not a heavy full-table-scan
  // summary. Cascades into a full history reload (reloadHistory: true) on
  // every fire, matching agent/players' equivalent behavior.
  const { lastSyncedAt, tierMs } = useLiveSync(
    ['profiles', 'bets', 'coin_ledger'],
    () => loadAgentDetails({ reloadHistory: true }),
    'fast'
  )

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    loadAgentDetails({ reloadHistory: true })
  }

  const handleSelectPlayer = (player: typeof players[0]) => {
    if (selectedPlayer?.id === player.id) {
      setShowMobileDetail(true)
      return
    }
    selectedPlayerIdRef.current = player.id // keep ref in sync
    setSelectedPlayer(player)
    setShowMobileDetail(true)
    setIsLoadingHistory(true)
    setGamePlays([])
    setPointsHistory([])
    setGamesPage(1)
    setPointsPage(1)
    loadPlayerHistory(player.id)
  }

  const handleToggleAgentStatus = async () => {
    if (!agentInfo) return
    setIsTogglingStatus(true)
    setToggleStatusError(null)
    // B-1 pattern: pass the DESIRED end state, never a derived "next status".
    const res = await setAgentActiveAction(resolvedAgentIdRef.current, !agentInfo.is_active)
    setIsTogglingStatus(false)
    if (res.success) {
      setAgentInfo({ ...agentInfo, is_active: !agentInfo.is_active, auto_locked_at: null })
      loadAgentDetails({ reloadHistory: false })
    } else if (res.error) {
      // Surfaces the auto-lock guard's "reset password instead" message --
      // previously this action could never fail, so there was nowhere for an
      // error to be shown.
      setToggleStatusError(res.error)
    }
  }

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsUpdatingPassword(true)
    setPasswordError(null)
    setPasswordSuccess(null)

    const res = await updateAgentPasswordAction(resolvedAgentIdRef.current, newPassword)

    setIsUpdatingPassword(false)
    if (res.error) {
      setPasswordError(res.error)
    } else {
      setPasswordSuccess('Agent password updated successfully!')
      setTimeout(() => {
        setIsPasswordModalOpen(false)
        setNewPassword('')
        setPasswordSuccess(null)
      }, 1200)
    }
  }

  const handleTransferPoints = async (type: 'deposit' | 'withdraw') => {
    const amountNum = parseFloat(transferAmount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setTransferError('Please enter a valid amount greater than 0.')
      return
    }

    setIsTransferring(true)
    setTransferError(null)

    const res = await issueAgentCoinsAction(resolvedAgentIdRef.current, amountNum, type === 'deposit' ? 'credit' : 'debit', transferReason.trim() || undefined)

    setIsTransferring(false)
    if (res.error) {
      setTransferError(res.error)
    } else {
      setTransferSuccess(`Successfully ${type === 'deposit' ? 'deposited' : 'withdrawn'} ${formatCurrency(amountNum)} Coins for @${agentInfo?.username || 'agent'}!`)
      loadAgentDetails({ reloadHistory: false })
      setTimeout(() => {
        setActiveTransferModal(null)
        setTransferAmount('')
        setTransferReason('')
        setTransferSuccess(null)
      }, 1200)
    }
  }

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto px-2 sm:px-4 md:px-0 pb-12">
      <ErrorBanner error={loadError} />
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <Link 
            href="/superadmin/agents" 
            className="p-2 rounded-xl bg-card border border-border/80 text-foreground hover:bg-secondary/80 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
                {agentInfo ? agentInfo.full_name : 'Agent Details'}
              </h1>
              {agentInfo && (
                <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[10px] font-black ${playerStatus(agentInfo).badgeClass}`}>
                  {playerStatus(agentInfo).label}
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-0.5 text-[11px] sm:text-xs flex items-center space-x-2 font-mono">
              <span>@{agentInfo ? agentInfo.username : '...'}</span>
              <span>&bull;</span>
              <span className="text-[10px]">Joined: {agentInfo?.joined_date || 'Jul 28, 2026'}</span>
            </p>
          </div>
        </div>

        {/* High-Contrast Quick Action Controls & Refresh Bar */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 w-full sm:w-auto">
          <LiveSyncBadge lastSyncedAt={lastSyncedAt} tierMs={tierMs} />
          <Button onClick={handleManualRefresh} disabled={isRefreshing} variant="outline" size="sm" className="h-8 sm:h-10 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border shrink-0">
            <RefreshCw className={`mr-1 h-3 w-3 sm:h-3.5 sm:w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {/* Deposit Modal */}
          <Dialog
            open={activeTransferModal === 'deposit'}
            onOpenChange={(open) => {
              setActiveTransferModal(open ? 'deposit' : null)
              setTransferAmount('')
              setTransferReason('')
              setTransferError(null)
              setTransferSuccess(null)
            }}
          >
            <DialogTrigger className="h-8 sm:h-10 px-2.5 sm:px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold shadow-sm cursor-pointer rounded-xl text-[11px] sm:text-xs flex items-center justify-center border-0">
              <ArrowUpRight className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Deposit
            </DialogTrigger>
            <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
              <DialogHeader>
                <DialogTitle className="font-black text-lg">Deposit Coins to Agent</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Issue coins to {agentInfo?.full_name}&apos;s account.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {transferError && (
                  <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                    {transferError}
                  </div>
                )}
                {transferSuccess && (
                  <div className="p-2.5 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center space-x-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span>{transferSuccess}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground font-semibold">Current Balance:</span>
                  <span className="font-mono font-black text-success-text">{formatCurrency(agentInfo?.coin_balance || 0)}</span>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-deposit-amount" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount (Coins)</Label>
                  <Input
                    id="agent-deposit-amount"
                    type="number"
                    step="1"
                    min="1"
                    placeholder="e.g. 1000"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="h-10 bg-background/60 border-border text-foreground text-xs rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-deposit-reason" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reason (Optional)</Label>
                  <Input
                    id="agent-deposit-reason"
                    type="text"
                    maxLength={500}
                    placeholder="e.g. Weekly float top-up"
                    value={transferReason}
                    onChange={(e) => setTransferReason(e.target.value)}
                    className="h-10 bg-background/60 border-border text-foreground text-xs rounded-lg"
                  />
                </div>
              </div>
              <DialogFooter className="pt-2">
                <Button
                  onClick={() => handleTransferPoints('deposit')}
                  disabled={isTransferring || !!transferSuccess}
                  className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold cursor-pointer rounded-lg text-xs"
                >
                  {isTransferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isTransferring ? 'Processing...' : 'Confirm Deposit'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Withdraw Modal */}
          <Dialog
            open={activeTransferModal === 'withdraw'}
            onOpenChange={(open) => {
              setActiveTransferModal(open ? 'withdraw' : null)
              setTransferAmount('')
              setTransferReason('')
              setTransferError(null)
              setTransferSuccess(null)
            }}
          >
            <DialogTrigger className="h-8 sm:h-10 px-2.5 sm:px-3 bg-secondary/80 hover:bg-secondary text-amber-400 border border-amber-500/30 font-extrabold shadow-sm cursor-pointer rounded-xl text-[11px] sm:text-xs flex items-center justify-center">
              <ArrowDownRight className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Withdraw
            </DialogTrigger>
            <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
              <DialogHeader>
                <DialogTitle className="font-black text-lg">Withdraw Coins from Agent</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Retrieve coins from {agentInfo?.full_name}&apos;s account back to cashier pool.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {transferError && (
                  <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                    {transferError}
                  </div>
                )}
                {transferSuccess && (
                  <div className="p-2.5 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center space-x-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span>{transferSuccess}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground font-semibold">Current Balance:</span>
                  <span className="font-mono font-black text-danger-text">{formatCurrency(agentInfo?.coin_balance || 0)}</span>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-withdraw-amount" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount (Coins)</Label>
                  <Input
                    id="agent-withdraw-amount"
                    type="number"
                    step="1"
                    min="1"
                    placeholder="e.g. 500"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="h-10 bg-background/60 border-border text-foreground text-xs rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-withdraw-reason" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reason (Optional)</Label>
                  <Input
                    id="agent-withdraw-reason"
                    type="text"
                    maxLength={500}
                    placeholder="e.g. Correcting a duplicate deposit"
                    value={transferReason}
                    onChange={(e) => setTransferReason(e.target.value)}
                    className="h-10 bg-background/60 border-border text-foreground text-xs rounded-lg"
                  />
                </div>
              </div>
              <DialogFooter className="pt-2">
                <Button
                  onClick={() => handleTransferPoints('withdraw')}
                  disabled={isTransferring || !!transferSuccess}
                  variant="destructive"
                  className="w-full h-10 font-extrabold cursor-pointer rounded-lg text-xs"
                >
                  {isTransferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isTransferring ? 'Processing...' : 'Confirm Withdrawal'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Change Password Modal */}
          <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
            <DialogTrigger className="h-8 sm:h-10 px-2.5 sm:px-3 bg-secondary/60 hover:bg-secondary border border-border text-foreground font-extrabold shadow-sm cursor-pointer rounded-xl text-[11px] sm:text-xs flex items-center justify-center">
              <Key className="mr-1 h-3.5 w-3.5" /> Password
            </DialogTrigger>
            <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
              <DialogHeader>
                <DialogTitle className="font-black text-lg">Update Agent Password</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Set a new password for {agentInfo?.full_name}.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleUpdatePassword} className="space-y-3 py-2">
                {passwordError && (
                  <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                    {passwordError}
                  </div>
                )}
                {passwordSuccess && (
                  <div className="p-2.5 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20">
                    {passwordSuccess}
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="new-password text-[10px]">New Password</Label>
                  <div className="relative">
                    <Input 
                      id="new-password" 
                      type={showPassword ? "text" : "password"} 
                      placeholder="••••••••" 
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-10 w-full bg-background border-border text-foreground pr-10 text-xs rounded-lg"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <DialogFooter className="pt-2">
                  <Button type="submit" disabled={isUpdatingPassword} className="w-full h-10 font-extrabold cursor-pointer text-xs rounded-lg">
                    {isUpdatingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isUpdatingPassword ? 'Updating Password...' : 'Update Password'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Block / Unblock Agent Button */}
          <Button 
            onClick={handleToggleAgentStatus}
            disabled={isTogglingStatus}
            variant="outline"
            className={`h-8 sm:h-10 px-2.5 sm:px-3 font-extrabold cursor-pointer rounded-xl text-[11px] sm:text-xs flex items-center justify-center ${
              agentInfo?.is_active 
                ? 'border-red-500/40 text-red-400 hover:bg-red-500/10' 
                : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
            }`}
          >
            {isTogglingStatus ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : (
              agentInfo?.is_active ? <UserX className="mr-1 h-3.5 w-3.5" /> : <UserCheck className="mr-1 h-3.5 w-3.5" />
            )}
            {agentInfo?.is_active ? 'Block' : 'Unblock'}
          </Button>
        </div>
      </div>

      {toggleStatusError && (
        <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
          {toggleStatusError}
        </div>
      )}

      {/* Stats Metric Strip (Compact Modern 3-Column Grid) */}
      <div className="grid gap-2 sm:gap-3 grid-cols-3">
        <Card className="bg-card border border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs hover:border-emerald-500/30 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground truncate">
              Coins
            </span>
            <div className="hidden sm:flex p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              <Coins className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            {isRefreshing ? (
              <div className="h-5 w-16 bg-secondary/80 rounded animate-pulse" />
            ) : (
              <div className="text-xs sm:text-lg font-mono font-black text-foreground tracking-tight truncate">
                {formatCurrency(agentInfo?.coin_balance || 0)}
              </div>
            )}
            <span className="text-[10px] text-muted-foreground font-medium hidden sm:inline">Available for allocation</span>
          </div>
        </Card>

        <Card className="bg-card border border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs hover:border-primary/30 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground truncate">
              Players
            </span>
            <div className="hidden sm:flex p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Users className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            {isRefreshing ? (
              <div className="h-5 w-10 bg-secondary/80 rounded animate-pulse" />
            ) : (
              <div className="text-xs sm:text-lg font-mono font-black text-foreground tracking-tight">
                {players.length}
              </div>
            )}
            <span className="text-[10px] text-muted-foreground font-medium hidden sm:inline">Sub-registered network</span>
          </div>
        </Card>

        <Card className="bg-card border border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs hover:border-amber-500/30 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground truncate">
              Status
            </span>
            <div className="hidden sm:flex p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <Activity className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-center justify-between mt-1">
            {agentInfo && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${playerStatus(agentInfo).badgeClass}`}>
                {playerStatus(agentInfo).label}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground font-medium hidden sm:inline">Operational status</span>
          </div>
        </Card>
      </div>

      {/* Main Player & History Layout Grid (3:9 Ratio) */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 min-h-[600px]">
        {/* --- LEFT SIDE: COMPACT PLAYERS LIST (md:col-span-1 = 20%) --- */}
        <div className={`md:col-span-1 space-y-2.5 ${showMobileDetail ? 'hidden md:block' : 'block'}`}>
          <div className="p-3 bg-card border border-border/80 rounded-2xl shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-foreground flex items-center space-x-1.5 whitespace-nowrap">
                <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>Players</span>
              </h3>
              <span className="inline-flex items-center px-2 py-0.2 rounded-full text-[10px] font-extrabold bg-primary/10 text-primary border border-primary/20 shrink-0 whitespace-nowrap">
                {players.length} total
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">Active directory under this agency.</p>

            <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-0.5 custom-scrollbar pt-1">
              {players.length > 0 ? (
                players.map((player) => {
                  const isSelected = selectedPlayer?.id === player.id
                  const isPlayerOnline = player.is_online && player.is_active
                  return (
                    <button
                      key={player.id}
                      onClick={() => handleSelectPlayer(player)}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col space-y-1 ${
                        isSelected
                          ? 'bg-primary/10 border-primary shadow-xs text-foreground'
                          : 'bg-card border-border/70 hover:bg-secondary/40 text-foreground'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 min-w-0">
                          <div className="relative shrink-0">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-[11px] ${
                              isSelected ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary border border-primary/20'
                            }`}>
                              {player.full_name[0]?.toUpperCase()}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
                              isPlayerOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                            }`} />
                          </div>
                          <span className="font-extrabold text-xs truncate leading-tight">{player.full_name}</span>
                        </div>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.2 text-[9px] font-black shrink-0 ${playerStatus(player).badgeClass}`}>
                          {playerStatus(player).label}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/30">
                        <span className="text-muted-foreground font-mono text-[10px] truncate">@{player.username}</span>
                        {isRefreshing ? (
                          <div className="h-3.5 w-12 bg-secondary/80 rounded animate-pulse shrink-0" />
                        ) : (
                          <span className="font-mono font-black text-foreground text-xs">{formatCurrency(player.coin_balance)}</span>
                        )}
                      </div>
                    </button>
                  )
                })
              ) : (
                <div className="p-6 text-center text-xs text-muted-foreground font-medium">
                  No players registered under this agent.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* --- RIGHT SIDE: PLAYER HISTORY (md:col-span-4 = 80%) --- */}
        <div className={`md:col-span-4 space-y-3 ${showMobileDetail ? 'block' : 'hidden md:block'}`}>
          {selectedPlayer ? (
            <div className="space-y-3">
              {/* 📊 SLIM HIGH-DENSITY PERFORMANCE METRIC STRIP */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center space-x-1.5">
                    <Activity className="h-3.5 w-3.5 text-primary" />
                    <h3 className="text-[10px] font-black uppercase tracking-wider text-foreground">
                      Player Performance Summary
                    </h3>
                  </div>

                  {/* Scope Toggle: Today vs Lifetime */}
                  <div className="flex items-center bg-secondary/40 border border-border/60 rounded-lg p-0.5 text-[9px] font-bold">
                    <button
                      onClick={() => setStatsScope('today')}
                      className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                        statsScope === 'today' ? 'bg-primary text-primary-foreground font-black shadow-xs' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Today
                    </button>
                    <button
                      onClick={() => setStatsScope('lifetime')}
                      className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                        statsScope === 'lifetime' ? 'bg-primary text-primary-foreground font-black shadow-xs' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Lifetime
                    </button>
                  </div>
                </div>

                {isLoadingHistory || isRefreshing ? (
                  /* Skeleton Loader for Performance Cards */
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
                    {/* Card 1: Total Plays */}
                    <Card className="bg-card border border-border/80 p-2.5 rounded-xl shadow-xs">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Plays</span>
                      <span className="text-base font-mono font-black text-foreground">{performanceStats.totalPlays}</span>
                    </Card>

                    {/* Card 2: Bet Volume */}
                    <Card className="bg-card border border-border/80 p-2.5 rounded-xl shadow-xs">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Bet Volume</span>
                      <span className="text-base font-mono font-black text-foreground">{formatCurrency(performanceStats.totalBet)}</span>
                    </Card>

                    {/* Card 3: Win Payout */}
                    <Card className="bg-card border border-border/80 p-2.5 rounded-xl shadow-xs">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Win Payout</span>
                      <span className="text-base font-mono font-black text-foreground">{formatCurrency(performanceStats.totalWin)}</span>
                    </Card>

                    {/* Card 4: Net House GGR / Agent Profit */}
                    <Card className={`border p-2.5 rounded-xl shadow-xs ${
                      performanceStats.netGgr >= 0 
                        ? 'bg-emerald-500/10 border-emerald-500/30' 
                        : 'bg-red-500/10 border-red-500/30'
                    }`}>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Net House GGR</span>
                      <div className="flex items-center justify-between">
                        <span className={`text-base font-mono font-black ${
                          performanceStats.netGgr >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {performanceStats.netGgr >= 0 ? `+${formatCurrency(performanceStats.netGgr)}` : formatCurrency(performanceStats.netGgr)}
                        </span>
                        <span className={`text-[9px] font-black px-1.5 py-0.2 rounded ${
                          performanceStats.netGgr >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {performanceStats.marginPct.toFixed(1)}%
                        </span>
                      </div>
                    </Card>
                  </div>
                )}
              </div>

              <Card className="border-border/80 bg-card rounded-2xl overflow-hidden shadow-md">
                {/* Header Bar with Player Online/Offline Status (Issue #92:
                    this is the player's own session activity from
                    active_sessions, not the dashboard's Realtime status --
                    was mislabeled "Real-Time Sync Active" before) */}
                <div className="p-3 sm:p-4 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-secondary/10">
                  <div className="flex items-center space-x-2.5">
                    <button
                      onClick={() => setShowMobileDetail(false)}
                      className="md:hidden p-1.5 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 focus:outline-none"
                      aria-label="Back to players list"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>

                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-sm">
                        {selectedPlayer.full_name[0]?.toUpperCase()}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
                        selectedPlayer.is_online && selectedPlayer.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                      }`} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <h3 className="text-xs sm:text-sm font-black text-foreground leading-tight truncate">
                          History of {selectedPlayer.full_name}
                        </h3>
                        <span className="text-[10px] font-mono text-muted-foreground bg-secondary/50 px-1.5 py-0.2 rounded font-bold">
                          {formatCurrency(selectedPlayer.coin_balance)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-[10px] font-mono">
                        <span className="text-muted-foreground truncate">@{selectedPlayer.username}</span>
                        <span className="text-muted-foreground/60">&bull;</span>
                        {selectedPlayer.is_online && selectedPlayer.is_active ? (
                          <span className="inline-flex items-center text-emerald-400 font-extrabold text-[9px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-ping" />
                            Player Online
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-red-400/80 font-bold text-[9px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1" />
                            Player Offline
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Date Filter & Quick Filter Pills */}
                  <div className="flex items-center flex-wrap gap-1.5 sm:gap-2">
                    {/* Today / Lifetime Quick Date Presets */}
                    <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] font-bold">
                      <button
                        // Issue #90 fix: "Today" is a real instant, so it
                        // genuinely needs the IST-aware conversion (unlike a
                        // Calendar pick below, which does not).
                        onClick={() => setFilterDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))}
                        className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer ${
                          filterDate === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
                            ? 'bg-primary text-primary-foreground font-black shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Today
                      </button>
                      <button
                        onClick={() => setFilterDate(undefined)}
                        className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer ${
                          !filterDate
                            ? 'bg-primary text-primary-foreground font-black shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Lifetime
                      </button>
                    </div>

                    <Popover>
                      <PopoverTrigger className="h-8 px-2.5 text-[11px] font-extrabold border border-border/80 bg-card hover:bg-secondary/60 rounded-xl flex items-center justify-center cursor-pointer">
                        <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                        {/* Display-only: parsed back to a local Date purely to
                            format it, never compared or sent anywhere. */}
                        {filterDate ? new Date(`${filterDate}T00:00:00`).toLocaleDateString() : 'Custom Date'}
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-card border-border" align="end">
                        <Calendar
                          mode="single"
                          selected={filterDate ? new Date(`${filterDate}T00:00:00`) : undefined}
                          // Issue #90 fix: a Calendar pick has no real instant
                          // to convert -- pickedDayKey reads back exactly the
                          // day the widget shows, in its own local frame.
                          onSelect={(d) => setFilterDate(d ? pickedDayKey(d) : undefined)}
                          disabled={(date) => date > new Date()}
                        />
                      </PopoverContent>
                    </Popover>

                    {filterDate && (
                      <Button 
                        variant="ghost" 
                        onClick={() => setFilterDate(undefined)} 
                        className="h-8 px-2 text-[10px] text-muted-foreground hover:text-foreground font-bold cursor-pointer"
                      >
                        <X className="mr-1 h-3 w-3" /> Clear
                      </Button>
                    )}

                    {/* Outcome Quick Filter Pills */}
                    {activeTab === 'games' && (
                      <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] font-bold">
                        {(['all', 'WON', 'LOST'] as const).map((outcome) => (
                          <button
                            key={outcome}
                            onClick={() => setFilterOutcome(outcome)}
                            className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer uppercase ${
                              filterOutcome === outcome ? 'bg-primary text-primary-foreground font-black shadow-xs' : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {outcome}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Mode Quick Filter Pills */}
                    {activeTab === 'games' && (
                      <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] font-bold">
                        {(['all', 'SINGLE', 'DOUBLE', 'TRIPLE'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setFilterMode(m)}
                            className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer uppercase ${
                              filterMode === m ? 'bg-primary text-primary-foreground font-black shadow-xs' : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Tab Controls */}
                <div className="flex border-b border-border/60 bg-secondary/20">
                <button
                  onClick={() => setActiveTab('games')}
                  className={`flex-1 py-2.5 text-xs font-extrabold transition-all flex items-center justify-center space-x-1.5 border-b-2 ${
                    activeTab === 'games' ? 'border-primary text-foreground bg-card' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Gamepad2 className="h-3.5 w-3.5 text-primary" />
                  <span>Game Plays</span>
                  {isLoadingHistory ? (
                    <span className="inline-block h-3 w-4 rounded bg-secondary/80 animate-pulse" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">({filteredGames.length})</span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('points')}
                  className={`flex-1 py-2.5 text-xs font-extrabold transition-all flex items-center justify-center space-x-1.5 border-b-2 ${
                    activeTab === 'points' ? 'border-primary text-foreground bg-card' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Coins className="h-3.5 w-3.5 text-amber-400" />
                  <span>Cashier Transfers</span>
                  {isLoadingHistory ? (
                    <span className="inline-block h-3 w-4 rounded bg-secondary/80 animate-pulse" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">({filteredPoints.length})</span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('profit')}
                  className={`flex-1 py-2.5 text-xs font-extrabold transition-all flex items-center justify-center space-x-1.5 border-b-2 ${
                    activeTab === 'profit' ? 'border-primary text-foreground bg-card' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                  <span>P&L Audit</span>
                  {isLoadingHistory ? (
                    <span className="inline-block h-3 w-4 rounded bg-secondary/80 animate-pulse" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">({profitPlayers.length})</span>
                  )}
                </button>
              </div>

              {/* Content Body */}
              <div className="overflow-hidden min-h-[380px]">
                {isLoadingHistory ? (
                  <div className="p-4 space-y-2.5">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-secondary/20 animate-pulse border border-border/40">
                        <div className="h-3.5 bg-secondary/80 rounded w-1/4" />
                        <div className="h-3.5 bg-secondary/60 rounded w-1/3" />
                        <div className="h-3.5 bg-secondary/70 rounded w-1/6" />
                        <div className="h-3.5 bg-secondary/80 rounded w-1/5" />
                      </div>
                    ))}
                  </div>
                ) : activeTab === 'games' ? (
                  filteredGames.length > 0 ? (
                    <>
                        {/* --- MOBILE CARDS VIEW (< sm) --- */}
                        <div className="space-y-2.5 sm:hidden p-3 bg-background/50">
                          {paginatedGames.map((spin) => {
                            const isWon = spin.total_payout > 0
                            return (
                              <Card key={spin.hand_id} className="p-3 bg-card border-border/70 rounded-xl space-y-2 shadow-xs">
                                {/* Card Header */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-2 min-w-0">
                                    <span className="font-mono text-xs font-black text-foreground">#{spin.hand_id}</span>
                                    <span className="text-xs font-semibold text-muted-foreground truncate">{'Triple Chance'}</span>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black ${
                                      isWon ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
                                    }`}>
                                      {isWon ? 'WON' : 'LOST'}
                                    </span>
                                    <GamePlayDetailDialog
                                      spin={spin}
                                      playerFullName={selectedPlayer?.full_name || ''}
                                      playerUsername={selectedPlayer?.username || ''}
                                      trigger={
                                        <button
                                          className="p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
                                          aria-label="View Details"
                                        >
                                          <Eye className="h-4 w-4" />
                                        </button>
                                      }
                                    />
                                  </div>
                                </div>

                                {/* Card Sub-header */}
                                <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                                  <span className="font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{spin.mode}</span>
                                  <span className="font-mono">{spin.created_at}</span>
                                </div>

                                {/* Card Metrics Strip */}
                                <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-secondary/30 text-center text-xs">
                                  <div>
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Result</span>
                                    <span className="font-mono font-black text-primary bg-primary/10 px-1.5 py-0.2 rounded inline-block">
                                      {spin.result.toString().padStart(3, '0')}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Bet</span>
                                    <span className="font-mono font-black text-foreground">{formatCurrency(spin.total_stake)}</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Win</span>
                                    <span className={`font-mono font-black ${spin.total_payout > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                                      {spin.total_payout > 0 ? `+${formatCurrency(spin.total_payout)}` : '-'}
                                    </span>
                                  </div>
                                </div>
                              </Card>
                            )
                          })}
                        </div>

                        {/* --- DESKTOP TABLE VIEW (>= sm) --- */}
                        <div className="hidden sm:block overflow-x-auto table-scroll">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                                <TableHead className="w-8"></TableHead>
                                <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Hand ID</TableHead>
                                <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[100px]">Game</TableHead>
                                <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[120px]">Mode</TableHead>
                                <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[130px]">Date & Time</TableHead>
                                <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win Result</TableHead>
                                <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Bet</TableHead>
                                <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win</TableHead>
                                <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[70px]">Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {paginatedGames.map((spin) => (
                                <TableRow key={spin.hand_id} className="border-border hover:bg-secondary/30 transition-colors">
                                  <TableCell className="p-2">
                                    <GamePlayDetailDialog
                                      spin={spin}
                                      playerFullName={selectedPlayer?.full_name || ''}
                                      playerUsername={selectedPlayer?.username || ''}
                                      trigger={
                                        <button
                                          className="p-1 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
                                          aria-label="View Details"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                        </button>
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5">{spin.hand_id}</TableCell>
                                  <TableCell className="text-[11px] font-semibold text-foreground p-2.5">{'Triple Chance'}</TableCell>
                                  <TableCell className="text-[11px] font-bold text-primary p-2.5">{spin.mode}</TableCell>
                                  <TableCell className="text-[11px] text-muted-foreground font-mono whitespace-nowrap p-2.5">{spin.created_at}</TableCell>
                                  <TableCell className="text-center p-2.5">
                                    <span className="font-mono font-black text-xs text-primary bg-primary/10 rounded-md px-2 py-0.5 inline-block">
                                      {spin.result.toString().padStart(3, '0')}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-[11px] font-bold text-foreground p-2.5">
                                    {formatCurrency(spin.total_stake)}
                                  </TableCell>
                                  <TableCell className={`text-right font-mono text-[11px] font-bold p-2.5 ${spin.total_payout > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                                    {spin.total_payout > 0 ? `+${formatCurrency(spin.total_payout)}` : '-'}
                                  </TableCell>
                                  <TableCell className="text-center p-2.5">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black ${
                                      spin.outcome === 'WON' ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
                                    }`}>
                                      {spin.outcome}
                                    </span>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {/* Pagination Bar for Game Plays */}
                        {filteredGames.length > itemsPerPage && (
                          <div className="p-3 border-t border-border/60">
                            <ResponsivePagination 
                              currentPage={gamesPage}
                              totalPages={Math.ceil(filteredGames.length / itemsPerPage)}
                              onPageChange={setGamesPage}
                              totalItems={filteredGames.length}
                              itemsPerPage={itemsPerPage}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="p-10 text-center text-xs text-muted-foreground font-medium">
                        No game play history recorded for the selected filter.
                      </div>
                    )
                  ) : activeTab === 'points' ? (
                      filteredPoints.length > 0 ? (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                              <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[110px]">Transaction ID</TableHead>
                              <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[130px]">Date & Time</TableHead>
                              <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[90px]">Type</TableHead>
                              <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[90px]">Amount</TableHead>
                              <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[110px]">Balance After</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paginatedPoints.map((tx) => (
                              <TableRow key={tx.id} className="border-border hover:bg-secondary/30 transition-colors">
                                <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5">{tx.id}</TableCell>
                                <TableCell className="text-[11px] text-muted-foreground p-2.5">{tx.created_at}</TableCell>
                                <TableCell className="text-[11px] p-2.5">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black uppercase ${
                                    tx.direction === 'deposit'
                                      ? 'bg-success-bg text-success-text border border-emerald-500/20'
                                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {tx.label}
                                  </span>
                                </TableCell>
                                <TableCell className={`text-right font-mono text-[11px] font-extrabold p-2.5 ${
                                  tx.direction === 'deposit' ? 'text-success-text' : 'text-amber-400'
                                }`}>
                                  {tx.direction === 'deposit' ? `+${formatCurrency(tx.amount)}` : `-${formatCurrency(tx.amount)}`}
                                </TableCell>
                                <TableCell className="text-right font-mono text-[11px] font-bold text-foreground p-2.5">
                                  {formatCurrency(tx.balance_after)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        {filteredPoints.length > itemsPerPage && (
                          <div className="p-3 border-t border-border/60">
                            <ResponsivePagination
                              currentPage={pointsPage}
                              totalPages={Math.ceil(filteredPoints.length / itemsPerPage)}
                              onPageChange={setPointsPage}
                              totalItems={filteredPoints.length}
                              itemsPerPage={itemsPerPage}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="p-10 text-center text-xs text-muted-foreground font-medium">
                        No cashier transfers recorded for this player.
                      </div>
                    )
                  ) : (
                    /* activeTab === 'profit' Player P/L Audit View */
                    profitPlayers.length > 0 ? (
                      <div className="p-3 space-y-3">
                        {/* Summary Micro Bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-secondary/20 p-2.5 rounded-xl border border-border/50 text-xs">
                          <div>
                            <span className="text-[9px] font-bold text-muted-foreground uppercase block">Today&apos;s P/L</span>
                            <span className={`font-mono font-black ${profitSummary.todays_profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {profitSummary.todays_profit >= 0 ? '+' : ''}{formatCurrency(profitSummary.todays_profit)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-muted-foreground uppercase block">Lifetime P/L</span>
                            <span className={`font-mono font-black ${profitSummary.lifetime_profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {profitSummary.lifetime_profit >= 0 ? '+' : ''}{formatCurrency(profitSummary.lifetime_profit)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-muted-foreground uppercase block">Total Bets</span>
                            <span className="font-mono font-bold text-foreground">{formatCurrency(profitSummary.total_stake)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-muted-foreground uppercase block">House Margin</span>
                            <span className={`font-mono font-black ${profitSummary.margin_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {profitSummary.margin_pct.toFixed(1)}%
                            </span>
                          </div>
                        </div>

                        {/* Player P/L Table */}
                        <Table>
                          <TableHeader className="bg-secondary/30">
                            <TableRow>
                              <TableHead className="text-[10px] uppercase font-black">Player</TableHead>
                              <TableHead className="text-[10px] uppercase font-black text-center">Plays</TableHead>
                              <TableHead className="text-[10px] uppercase font-black text-right">Bets (In)</TableHead>
                              <TableHead className="text-[10px] uppercase font-black text-right">Wins (Out)</TableHead>
                              <TableHead className="text-[10px] uppercase font-black text-right">Net P/L (+/-)</TableHead>
                              <TableHead className="text-[10px] uppercase font-black text-right">Margin %</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className="divide-y divide-border/60">
                            {profitPlayers.map((p) => (
                              <TableRow key={p.id} className="hover:bg-secondary/20 transition-colors">
                                <TableCell className="py-2">
                                  <span className="font-mono text-xs font-black text-foreground">@{p.username}</span>
                                </TableCell>
                                <TableCell className="py-2 text-center font-mono text-xs text-muted-foreground font-bold">
                                  {p.play_count}
                                </TableCell>
                                <TableCell className="py-2 text-right font-mono text-xs text-foreground font-bold">
                                  {formatCurrency(p.total_stake)}
                                </TableCell>
                                <TableCell className="py-2 text-right font-mono text-xs text-amber-500 font-bold">
                                  {formatCurrency(p.total_payout)}
                                </TableCell>
                                <TableCell className={`py-2 text-right font-mono text-xs font-black ${p.net_profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {p.net_profit >= 0 ? '+' : ''}{formatCurrency(p.net_profit)}
                                </TableCell>
                                <TableCell className={`py-2 text-right font-mono text-xs font-black ${p.margin_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {p.margin_pct.toFixed(1)}%
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="p-10 text-center text-xs text-muted-foreground font-medium">
                        No profit/loss data recorded for this agent.
                      </div>
                    )
                  )}
                </div>
              </Card>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-12 text-center border border-border/60 bg-card rounded-2xl">
              <p className="text-xs text-muted-foreground font-medium">Select a player from the list to view details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
