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
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Users, Coins, Activity, CalendarIcon, ArrowUpRight, ArrowDownRight, Loader2, UserX, UserCheck, Key, Eye, EyeOff, ChevronRight, Gamepad2, X, RefreshCw, TrendingUp, Percent, Award, CheckCircle2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"
import type { PlayerProfitRow } from '@/app/agent/profit/actions'
import type { PlayerGamePlay, PlayerCoinMovement } from '@/app/agent/players/actions'
import { getAgentDetailAction, issueAgentCoinsAction, setAgentActiveAction, updateAgentPasswordAction } from '../actions'
import { getPlayerDetailHistoryAction } from '@/app/agent/players/actions'
import { getAgentProfitReportAction } from '@/app/agent/profit/actions'

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
    joined_date: string
  } | null>(null)
  const [players, setPlayers] = React.useState<Array<{
    id: string
    full_name: string
    username: string
    coin_balance: number
    is_active: boolean
    is_online: boolean
  }>>([])
  const [selectedPlayer, setSelectedPlayer] = React.useState<typeof players[0] | null>(null)
  const [showMobileDetail, setShowMobileDetail] = React.useState(false)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [countdown, setCountdown] = React.useState(90)
  // Stable refs — avoid interval leaks caused by state deps in useCallback
  const selectedPlayerIdRef = React.useRef<string | null>(null)
  const filterDateRef = React.useRef<Date | undefined>(undefined)
  const statsScopeRef = React.useRef<'today' | 'lifetime'>('today')
  const isInitialMountRef = React.useRef(true)

  const [gamePlays, setGamePlays] = React.useState<PlayerGamePlay[]>([])
  const [expandedSpins, setExpandedSpins] = React.useState<Record<string, boolean>>({})

  const toggleSpinExpand = (spinId: string) => {
    setExpandedSpins(prev => ({ ...prev, [spinId]: !prev[spinId] }))
  }
  const [pointsHistory, setPointsHistory] = React.useState<PlayerCoinMovement[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<'games' | 'points' | 'profit'>('games')
  const [profitSummary, setProfitSummary] = React.useState({ todays_profit: 0, lifetime_profit: 0, total_stake: 0, total_payout: 0, margin_pct: 0 })
  const [profitPlayers, setProfitPlayers] = React.useState<PlayerProfitRow[]>([])
  
  // Filter & Scope States
  const [statsScope, setStatsScope] = React.useState<'today' | 'lifetime'>('today')
  const [filterDate, setFilterDate] = React.useState<Date | undefined>(undefined)
  const [filterOutcome, setFilterOutcome] = React.useState<'all' | 'WON' | 'LOST'>('all')
  const [filterMode, setFilterMode] = React.useState<'all' | 'SINGLE' | 'DOUBLE' | 'TRIPLE'>('all')

  // Point transfer modal state
  const [activeTransferModal, setActiveTransferModal] = React.useState<'deposit' | 'withdraw' | null>(null)
  const [transferAmount, setTransferAmount] = React.useState('')
  const [isTransferring, setIsTransferring] = React.useState(false)
  const [transferError, setTransferError] = React.useState<string | null>(null)
  const [transferSuccess, setTransferSuccess] = React.useState<string | null>(null)

  // Status toggle state
  const [isTogglingStatus, setIsTogglingStatus] = React.useState(false)

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

  // Reset pagination when filters change
  React.useEffect(() => {
    setGamesPage(1)
    setPointsPage(1)
  }, [filterDate, filterOutcome, filterMode])

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
      // Date Filter
      if (filterDate) {
        const filterDateStr = filterDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        const spinDateStr = spin.created_at_iso 
          ? new Date(spin.created_at_iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
          : spin.created_at
        if (spinDateStr !== filterDateStr) return false
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
      if (filterDate) {
        const filterDateStr = filterDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        const txDateStr = tx.created_at_iso
          ? new Date(tx.created_at_iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
          : tx.created_at
        if (txDateStr !== filterDateStr) return false
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

  const loadPlayerHistory = React.useCallback((playerId: string) => {
    setIsLoadingHistory(true)
    setGamesPage(1)
    setPointsPage(1)
    getPlayerDetailHistoryAction(playerId).then((res) => {
      setIsLoadingHistory(false)
      if (res) {
        setGamePlays(res.game_plays)
        setPointsHistory(res.coin_movements)
      }
    })
  }, [])

  const loadAgentDetails = React.useCallback((opts?: { showIndicator?: boolean; reloadHistory?: boolean }) => {
    const showIndicator = opts?.showIndicator ?? false
    const reloadHistory = opts?.reloadHistory ?? false
    if (showIndicator) setIsRefreshing(true)
    Promise.all([
      getAgentDetailAction(agentUsername),
      getAgentProfitReportAction({
        targetAgentId: resolvedAgentIdRef.current || agentUsername,
        datePreset: statsScopeRef.current,
        filterDate: filterDateRef.current ? filterDateRef.current.toISOString() : undefined
      })
    ]).then(([res, resProf]) => {
      if (showIndicator) setIsRefreshing(false)
      if (res.agent) setAgentInfo(res.agent)
      // Store the resolved UUID so other actions (transfer, toggle, password) can use it
      if (res.agent?.id) resolvedAgentIdRef.current = res.agent?.id
      else if (res.agent?.id) resolvedAgentIdRef.current = res.agent.id
      if (res.players) {
        setPlayers(res.players)
        const targetId = selectedPlayerIdRef.current
        if (targetId) {
          const updated = res.players.find(p => p.id === targetId)
          if (updated) {
            setSelectedPlayer(updated)
            // Only reload history on explicit request, NOT on silent auto-tick
            if (reloadHistory) loadPlayerHistory(updated.id)
          }
        } else if (res.players.length > 0) {
          selectedPlayerIdRef.current = res.players[0].id
          setSelectedPlayer(res.players[0])
          loadPlayerHistory(res.players[0].id)
        }
      }
      if (resProf) {
        setProfitSummary(resProf.summary)
        setProfitPlayers(resProf.players)
      }
    }).catch(() => { if (showIndicator) setIsRefreshing(false) })
  }, [agentUsername, loadPlayerHistory]) // Stable — agentUsername from params, loadPlayerHistory has [] deps

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
    loadAgentDetails({ showIndicator: false, reloadHistory: false })
  }, [filterDate, statsScope, loadAgentDetails])

  React.useEffect(() => {
    loadAgentDetails({ showIndicator: false, reloadHistory: true }) // initial: full load

    // 1s countdown tick — UI only, no DB fetch
    const countdownTick = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? 90 : prev - 1))
    }, 1000)

    // 90s data interval — silent, balances + player list only (no history cascade)
    const dataInterval = setInterval(() => {
      setCountdown(90)
      loadAgentDetails({ showIndicator: false })
    }, 90000)

    return () => {
      clearInterval(countdownTick)
      clearInterval(dataInterval)
    }
  }, [loadAgentDetails])

  const handleManualRefresh = async () => {
    setCountdown(90)
    loadAgentDetails({ showIndicator: true, reloadHistory: true })
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
    // B-1 pattern: pass the DESIRED end state, never a derived "next status".
    const res = await setAgentActiveAction(resolvedAgentIdRef.current, !agentInfo.is_active)
    setIsTogglingStatus(false)
    if (res.success) {
      setAgentInfo({ ...agentInfo, is_active: !agentInfo.is_active })
      loadAgentDetails({ showIndicator: false, reloadHistory: false })
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

    const res = await issueAgentCoinsAction(resolvedAgentIdRef.current, amountNum, type === 'deposit' ? 'credit' : 'debit')

    setIsTransferring(false)
    if (res.error) {
      setTransferError(res.error)
    } else {
      setTransferSuccess(`Successfully ${type === 'deposit' ? 'deposited' : 'withdrawn'} ${formatCurrency(amountNum)} Coins for @${agentInfo?.username || 'agent'}!`)
      loadAgentDetails({ showIndicator: false, reloadHistory: false })
      setTimeout(() => {
        setActiveTransferModal(null)
        setTransferAmount('')
        setTransferSuccess(null)
      }, 1200)
    }
  }

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto px-2 sm:px-4 md:px-0 pb-12">
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
              <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[10px] font-black ${
                agentInfo?.is_active ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
              }`}>
                {agentInfo?.is_active ? 'Active' : 'Blocked'}
              </span>
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
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Auto-Sync ({countdown}s)
          </span>
          <Button onClick={handleManualRefresh} variant="outline" size="sm" className="h-8 sm:h-10 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border shrink-0">
            <RefreshCw className={`mr-1 h-3 w-3 sm:h-3.5 sm:w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {/* Deposit Modal */}
          <Dialog
            open={activeTransferModal === 'deposit'}
            onOpenChange={(open) => {
              setActiveTransferModal(open ? 'deposit' : null)
              setTransferAmount('')
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
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
              agentInfo?.is_active ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
            }`}>
              {agentInfo?.is_active ? 'Active' : 'Blocked'}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium hidden sm:inline">Operational status</span>
          </div>
        </Card>
      </div>

      {/* Main Player & History Layout Grid (3:9 Ratio) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 min-h-[600px]">
        {/* --- LEFT SIDE: COMPACT PLAYERS LIST (md:col-span-3) --- */}
        <div className={`md:col-span-3 space-y-2.5 ${showMobileDetail ? 'hidden md:block' : 'block'}`}>
          <div className="p-3 bg-card border border-border/80 rounded-2xl shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-foreground flex items-center space-x-1.5">
                <Users className="h-3.5 w-3.5 text-primary" />
                <span>Agent Players</span>
              </h3>
              <span className="inline-flex items-center px-2 py-0.2 rounded-full text-[10px] font-extrabold bg-primary/10 text-primary border border-primary/20">
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
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.2 text-[9px] font-black shrink-0 ${
                          player.is_active
                            ? 'bg-success-bg text-success-text border border-emerald-500/20'
                            : 'bg-danger-bg text-danger-text border border-red-500/20'
                        }`}>
                          {player.is_active ? 'Active' : 'Blocked'}
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

        {/* --- RIGHT SIDE: PLAYER HISTORY (md:col-span-9) --- */}
        <div className={`md:col-span-9 space-y-3 ${showMobileDetail ? 'block' : 'hidden md:block'}`}>
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
                {/* Header Bar with Live Sync Indicator */}
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
                            Real-Time Sync Active
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
                        onClick={() => setFilterDate(new Date())}
                        className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer ${
                          filterDate && filterDate.toDateString() === new Date().toDateString()
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
                        {filterDate ? filterDate.toLocaleDateString() : 'Custom Date'}
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-card border-border" align="end">
                        <Calendar
                          mode="single"
                          selected={filterDate}
                          onSelect={setFilterDate}
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
                  <span>Coins History</span>
                  {isLoadingHistory ? (
                    <span className="inline-block h-3 w-4 rounded bg-secondary/80 animate-pulse" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">({pointsHistory.length})</span>
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
                            const isExpanded = !!expandedSpins[spin.hand_id]
                            const singleCount = Object.keys(spin.single_bets || {}).length
                            const doubleCount = Object.keys(spin.double_bets || {}).length
                            const tripleCount = Object.keys(spin.triple_bets || {}).length
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
                                    <button
                                      onClick={() => toggleSpinExpand(spin.hand_id)}
                                      className="p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none transition-transform duration-200"
                                      style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                      aria-label="Toggle Details"
                                    >
                                      <ChevronRight className="h-4 w-4" />
                                    </button>
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

                                {/* Mobile Expanded Breakdown Cards */}
                                {isExpanded && (
                                  <div className="space-y-2 pt-2 border-t border-border/60">
                                    {/* Single Digit Picks (Black) */}
                                    <div className="p-2.5 rounded-lg bg-secondary/20 border border-border/50">
                                      <div className="flex items-center justify-between mb-1.5">
                                        <h4 className="font-black text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-full bg-zinc-950 border border-zinc-600 shrink-0" />
                                          Single Picks (Black)
                                        </h4>
                                        <span className="text-[9px] font-mono font-bold text-muted-foreground bg-secondary/60 px-1.5 py-0.2 rounded">
                                          {singleCount} {singleCount === 1 ? 'pick' : 'picks'}
                                        </span>
                                      </div>
                                      {singleCount > 0 ? (
                                        <div className="space-y-1 max-h-[140px] overflow-y-auto pr-0.5 custom-scrollbar">
                                          {Object.entries(spin.single_bets).map(([num, val]) => {
                                            const isWinning = spin.black !== null && num === spin.black.toString()
                                            return (
                                              <div key={num} className={`w-full flex items-center justify-between p-1.5 rounded-md text-[11px] ${
                                                isWinning ? 'bg-zinc-950 text-white border border-zinc-700 font-extrabold' : 'bg-card text-foreground border border-border/40'
                                              }`}>
                                                <span>Digit: <strong className="font-black text-primary">{num}</strong></span>
                                                <span className="font-mono font-bold">{formatCurrency(val)} Coins</span>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-[10px] text-muted-foreground italic">No Single bets placed.</p>
                                      )}
                                    </div>

                                    {/* Double Digit Picks (Green) */}
                                    <div className="p-2.5 rounded-lg bg-secondary/20 border border-border/50">
                                      <div className="flex items-center justify-between mb-1.5">
                                        <h4 className="font-black text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                          Double Picks (Green)
                                        </h4>
                                        <span className="text-[9px] font-mono font-bold text-muted-foreground bg-secondary/60 px-1.5 py-0.2 rounded">
                                          {doubleCount} {doubleCount === 1 ? 'pick' : 'picks'}
                                        </span>
                                      </div>
                                      {doubleCount > 0 ? (
                                        <div className="space-y-1 max-h-[140px] overflow-y-auto pr-0.5 custom-scrollbar">
                                          {Object.entries(spin.double_bets).map(([num, val]) => {
                                            const targetDouble = (spin.green !== null && spin.black !== null) 
                                              ? `${spin.green}${spin.black}` 
                                              : null
                                            const isWinning = targetDouble !== null && num.padStart(2, '0') === targetDouble.padStart(2, '0')
                                            return (
                                              <div key={num} className={`w-full flex items-center justify-between p-1.5 rounded-md text-[11px] ${
                                                isWinning ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-extrabold' : 'bg-card text-foreground border border-border/40'
                                              }`}>
                                                <span>Picks: <strong className="font-black text-primary">{num.padStart(2, '0')}</strong></span>
                                                <span className="font-mono font-bold">{formatCurrency(val)} Coins</span>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-[10px] text-muted-foreground italic">No Double bets placed.</p>
                                      )}
                                    </div>

                                    {/* Triple Digit Picks (Red) */}
                                    <div className="p-2.5 rounded-lg bg-secondary/20 border border-border/50">
                                      <div className="flex items-center justify-between mb-1.5">
                                        <h4 className="font-black text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                          Triple Picks (Red)
                                        </h4>
                                        <span className="text-[9px] font-mono font-bold text-muted-foreground bg-secondary/60 px-1.5 py-0.2 rounded">
                                          {tripleCount} {tripleCount === 1 ? 'pick' : 'picks'}
                                        </span>
                                      </div>
                                      {tripleCount > 0 ? (
                                        <div className="space-y-1 max-h-[140px] overflow-y-auto pr-0.5 custom-scrollbar">
                                          {Object.entries(spin.triple_bets).map(([num, val]) => {
                                            const targetTriple = (spin.red !== null && spin.green !== null && spin.black !== null) 
                                              ? `${spin.red}${spin.green}${spin.black}` 
                                              : null
                                            const isWinning = targetTriple !== null && num.padStart(3, '0') === targetTriple.padStart(3, '0')
                                            return (
                                              <div key={num} className={`w-full flex items-center justify-between p-1.5 rounded-md text-[11px] ${
                                                isWinning ? 'bg-red-500/20 text-red-400 border border-red-500/40 font-extrabold' : 'bg-card text-foreground border border-border/40'
                                              }`}>
                                                <span>Picks: <strong className="font-black text-primary">{num.padStart(3, '0')}</strong></span>
                                                <span className="font-mono font-bold">{formatCurrency(val)} Coins</span>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-[10px] text-muted-foreground italic">No Triple bets placed.</p>
                                      )}
                                    </div>
                                  </div>
                                )}
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
                              {paginatedGames.map((spin) => {
                                const isExpanded = !!expandedSpins[spin.hand_id]
                                const singleCount = Object.keys(spin.single_bets || {}).length
                                const doubleCount = Object.keys(spin.double_bets || {}).length
                                const tripleCount = Object.keys(spin.triple_bets || {}).length

                                return (
                                  <React.Fragment key={spin.hand_id}>
                                    <TableRow className="border-border hover:bg-secondary/30 transition-colors">
                                      <TableCell className="p-2">
                                        <button
                                          onClick={() => toggleSpinExpand(spin.hand_id)}
                                          className="p-1 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none transition-transform duration-200"
                                          style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                          aria-label={isExpanded ? "Collapse details" : "Expand details"}
                                        >
                                          <ChevronRight className="h-3.5 w-3.5" />
                                        </button>
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

                                    {/* Expanded Desktop Breakdown Panel */}
                                    {isExpanded && (
                                      <TableRow className="border-border bg-secondary/10 hover:bg-secondary/10">
                                        <TableCell colSpan={9} className="p-3 sm:p-4">
                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            {/* Single Digit Picks (Black) */}
                                            <div className="p-3 rounded-xl bg-card border border-border/70 shadow-xs">
                                              <div className="flex items-center justify-between mb-2">
                                                <h4 className="font-black text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                  <span className="w-2 h-2 rounded-full bg-zinc-950 border border-zinc-600 shrink-0" />
                                                  Single Picks (Black)
                                                </h4>
                                                <span className="text-[10px] font-mono font-bold text-muted-foreground bg-secondary/60 px-1.5 py-0.2 rounded">
                                                  {singleCount} {singleCount === 1 ? 'pick' : 'picks'}
                                                </span>
                                              </div>
                                              {singleCount > 0 ? (
                                                <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                                                  {Object.entries(spin.single_bets).map(([num, val]) => {
                                                    const isWinning = spin.black !== null && num === spin.black.toString()
                                                    return (
                                                      <div key={num} className={`w-full flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                                                        isWinning ? 'bg-zinc-950 text-white border border-zinc-700 font-extrabold shadow-sm' : 'bg-secondary/30 text-foreground border border-border/40'
                                                      }`}>
                                                        <span>Digit: <strong className="font-black text-primary">{num}</strong></span>
                                                        <span className="font-mono font-bold">{formatCurrency(val)} Coins</span>
                                                      </div>
                                                    )
                                                  })}
                                                </div>
                                              ) : (
                                                <p className="text-[10px] text-muted-foreground italic py-1">No Single bets placed.</p>
                                              )}
                                            </div>

                                            {/* Double Digit Picks (Green) */}
                                            <div className="p-3 rounded-xl bg-card border border-border/70 shadow-xs">
                                              <div className="flex items-center justify-between mb-2">
                                                <h4 className="font-black text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                                  Double Picks (Green)
                                                </h4>
                                                <span className="text-[10px] font-mono font-bold text-muted-foreground bg-secondary/60 px-1.5 py-0.2 rounded">
                                                  {doubleCount} {doubleCount === 1 ? 'pick' : 'picks'}
                                                </span>
                                              </div>
                                              {doubleCount > 0 ? (
                                                <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                                                  {Object.entries(spin.double_bets).map(([num, val]) => {
                                                    const targetDouble = (spin.green !== null && spin.black !== null) 
                                                      ? `${spin.green}${spin.black}` 
                                                      : null
                                                    const isWinning = targetDouble !== null && num.padStart(2, '0') === targetDouble.padStart(2, '0')
                                                    return (
                                                      <div key={num} className={`w-full flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                                                        isWinning ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-extrabold shadow-sm' : 'bg-secondary/30 text-foreground border border-border/40'
                                                      }`}>
                                                        <span>Picks: <strong className="font-black text-primary">{num.padStart(2, '0')}</strong></span>
                                                        <span className="font-mono font-bold">{formatCurrency(val)} Coins</span>
                                                      </div>
                                                    )
                                                  })}
                                                </div>
                                              ) : (
                                                <p className="text-[10px] text-muted-foreground italic py-1">No Double bets placed.</p>
                                              )}
                                            </div>

                                            {/* Triple Digit Picks (Red) */}
                                            <div className="p-3 rounded-xl bg-card border border-border/70 shadow-xs">
                                              <div className="flex items-center justify-between mb-2">
                                                <h4 className="font-black text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                                  Triple Picks (Red)
                                                </h4>
                                                <span className="text-[10px] font-mono font-bold text-muted-foreground bg-secondary/60 px-1.5 py-0.2 rounded">
                                                  {tripleCount} {tripleCount === 1 ? 'pick' : 'picks'}
                                                </span>
                                              </div>
                                              {tripleCount > 0 ? (
                                                <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                                                  {Object.entries(spin.triple_bets).map(([num, val]) => {
                                                    const targetTriple = (spin.red !== null && spin.green !== null && spin.black !== null) 
                                                      ? `${spin.red}${spin.green}${spin.black}` 
                                                      : null
                                                    const isWinning = targetTriple !== null && num.padStart(3, '0') === targetTriple.padStart(3, '0')
                                                    return (
                                                      <div key={num} className={`w-full flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                                                        isWinning ? 'bg-red-500/20 text-red-400 border border-red-500/40 font-extrabold shadow-sm' : 'bg-secondary/30 text-foreground border border-border/40'
                                                      }`}>
                                                        <span>Picks: <strong className="font-black text-primary">{num.padStart(3, '0')}</strong></span>
                                                        <span className="font-mono font-bold">{formatCurrency(val)} Coins</span>
                                                      </div>
                                                    )
                                                  })}
                                                </div>
                                              ) : (
                                                <p className="text-[10px] text-muted-foreground italic py-1">No Triple bets placed.</p>
                                              )}
                                            </div>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    )}
                                  </React.Fragment>
                                )
                              })}
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
                                    {tx.direction}
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
                        No coin transactions recorded for this player.
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
