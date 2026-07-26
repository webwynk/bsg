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
import { ArrowLeft, Users, Coins, Activity, CalendarIcon, ArrowUpRight, ArrowDownRight, Loader2, UserX, UserCheck, Key, Eye, EyeOff, ChevronRight, Gamepad2, X, RefreshCw, TrendingUp, Percent, Award } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { getAgentDetailAction, transferPointsAction, toggleAgentStatusAction, updateAgentPasswordAction } from '../actions'
import { getPlayerDetailHistoryAction } from '@/app/agent/players/actions'
import { getAgentProfitReportAction } from '@/app/agent/profit/actions'

interface Props {
  params: React.Usable<{ agentId: string }>
}

export default function AgentDetailPage({ params }: Props) {
  const { agentId } = React.use(params)
  
  const [agentInfo, setAgentInfo] = React.useState<{ id: string; name: string; username: string; balance: number; status: string } | null>(null)
  const [players, setPlayers] = React.useState<Array<{ id: string; name: string; username: string; balance: number; status: string; isOnline?: boolean; gamePlays: number }>>([])
  const [selectedPlayer, setSelectedPlayer] = React.useState<typeof players[0] | null>(null)
  const [showMobileDetail, setShowMobileDetail] = React.useState(false)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  const [gamePlays, setGamePlays] = React.useState<Array<{
    id: string
    game: string
    mode: string
    selections: string
    resultNumber: number
    bet: number
    win: number
    status: 'WON' | 'LOST'
    date: string
    singleBets: Record<string, number>
    doubleBets: Record<string, number>
    tripleBets: Record<string, number>
    redDigit: number | null
    greenDigit: number | null
    blackDigit: number | null
  }>>([])
  const [expandedSpins, setExpandedSpins] = React.useState<Record<string, boolean>>({})

  const toggleSpinExpand = (spinId: string) => {
    setExpandedSpins(prev => ({ ...prev, [spinId]: !prev[spinId] }))
  }
  const [pointsHistory, setPointsHistory] = React.useState<Array<{ id: string; type: 'deposit' | 'withdraw'; amount: number; balanceAfter: number; date: string }>>([])
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<'games' | 'points' | 'profit'>('games')
  const [profitSummary, setProfitSummary] = React.useState({ todaysPnl: 0, lifetimePnl: 0, totalVolume: 0, totalPayouts: 0, netMarginPct: 0 })
  const [profitPlayers, setProfitPlayers] = React.useState<Array<{
    id: string
    username: string
    isActive: boolean
    balance: number
    totalPlays: number
    totalBets: number
    totalWins: number
    netPnl: number
    marginPct: number
    lastPlayedAt: string
  }>>([])
  
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
    const todayStr = new Date().toLocaleDateString('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })

    const targetPlays = gamePlays.filter(spin => {
      if (statsScope === 'today') {
        return spin.date.includes(todayStr)
      }
      return true
    })

    const totalPlays = targetPlays.length
    const totalBet = targetPlays.reduce((sum, p) => sum + p.bet, 0)
    const totalWin = targetPlays.reduce((sum, p) => sum + p.win, 0)
    const netGgr = totalBet - totalWin
    const marginPct = totalBet > 0 ? (netGgr / totalBet) * 100 : 0

    return { totalPlays, totalBet, totalWin, netGgr, marginPct }
  }, [gamePlays, statsScope])

  // Filtered games list
  const filteredGames = React.useMemo(() => {
    return gamePlays.filter(spin => {
      // Date Filter
      if (filterDate) {
        const filterDateStr = filterDate.toLocaleDateString('en-US', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        })
        if (!spin.date.includes(filterDateStr)) return false
      }

      // Outcome Filter
      if (filterOutcome !== 'all' && spin.status !== filterOutcome) {
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
        const filterDateStr = filterDate.toLocaleDateString('en-US', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        })
        if (!tx.date.includes(filterDateStr)) return false
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
        setGamePlays(res.gamePlays)
        setPointsHistory(res.pointsHistory)
      }
    })
  }, [])

  const loadAgentDetails = React.useCallback(() => {
    setIsRefreshing(true)
    Promise.all([
      getAgentDetailAction(agentId),
      getAgentProfitReportAction({ targetAgentId: agentId, datePreset: statsScope, filterDate: filterDate ? filterDate.toISOString() : undefined })
    ]).then(([res, resProf]) => {
      setIsRefreshing(false)
      if (res.agent) {
        setAgentInfo(res.agent)
      }
      if (res.players) {
        setPlayers(res.players)
        const targetPlayer = res.players.find(p => p.id === selectedPlayer?.id) || (res.players.length > 0 ? res.players[0] : null)
        if (targetPlayer) {
          setSelectedPlayer(targetPlayer)
          loadPlayerHistory(targetPlayer.id)
        }
      }
      if (resProf) {
        setProfitSummary(resProf.summary)
        setProfitPlayers(resProf.players)
      }
    }).catch(() => setIsRefreshing(false))
  }, [agentId, selectedPlayer?.id, loadPlayerHistory, filterDate, statsScope])

  React.useEffect(() => {
    loadAgentDetails()
    const interval = setInterval(() => {
      loadAgentDetails()
    }, 30000)
    return () => clearInterval(interval)
  }, [loadAgentDetails])

  const handleManualRefresh = async () => {
    loadAgentDetails()
  }

  const handleSelectPlayer = (player: typeof players[0]) => {
    if (selectedPlayer?.id === player.id) {
      setShowMobileDetail(true)
      return
    }
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
    const res = await toggleAgentStatusAction(agentId, agentInfo.status)
    setIsTogglingStatus(false)
    if (res.success && res.newStatus) {
      setAgentInfo({ ...agentInfo, status: res.newStatus })
      loadAgentDetails()
    }
  }

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsUpdatingPassword(true)
    setPasswordError(null)
    setPasswordSuccess(null)

    const res = await updateAgentPasswordAction(agentId, newPassword)

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

    const res = await transferPointsAction(agentId, amountNum, type)

    setIsTransferring(false)
    if (res.error) {
      setTransferError(res.error)
    } else {
      setActiveTransferModal(null)
      setTransferAmount('')
      loadAgentDetails()
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
                {agentInfo ? agentInfo.name : 'Agent Details'}
              </h1>
              <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[10px] font-black ${
                agentInfo?.status === 'Active' ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
              }`}>
                {agentInfo?.status || 'Active'}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-[11px] sm:text-xs flex items-center space-x-2 font-mono">
              <span>@{agentInfo ? agentInfo.username : '...'}</span>
              <span>&bull;</span>
              <span className="text-[10px]">ID: {agentId}</span>
            </p>
          </div>
        </div>

        {/* High-Contrast Quick Action Controls & Refresh Bar */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 w-full sm:w-auto">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Auto-Sync (30s)
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
            }}
          >
            <DialogTrigger className="h-8 sm:h-10 px-2.5 sm:px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold shadow-sm cursor-pointer rounded-xl text-[11px] sm:text-xs flex items-center justify-center border-0">
              <ArrowUpRight className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Deposit
            </DialogTrigger>
            <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
              <DialogHeader>
                <DialogTitle className="font-black text-lg">Deposit Coins to Agent</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Issue coins to {agentInfo?.name}&apos;s account.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {transferError && (
                  <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                    {transferError}
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground font-semibold">Current Balance:</span>
                  <span className="font-mono font-black text-success-text">{formatCurrency(agentInfo?.balance || 0)}</span>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-deposit-amount" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount (Coins)</Label>
                  <Input 
                    id="agent-deposit-amount" 
                    type="number" 
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
                  disabled={isTransferring}
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
            }}
          >
            <DialogTrigger className="h-8 sm:h-10 px-2.5 sm:px-3 bg-secondary/80 hover:bg-secondary text-amber-400 border border-amber-500/30 font-extrabold shadow-sm cursor-pointer rounded-xl text-[11px] sm:text-xs flex items-center justify-center">
              <ArrowDownRight className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Withdraw
            </DialogTrigger>
            <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
              <DialogHeader>
                <DialogTitle className="font-black text-lg">Withdraw Coins from Agent</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Retrieve coins from {agentInfo?.name}&apos;s account back to cashier pool.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {transferError && (
                  <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                    {transferError}
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground font-semibold">Current Balance:</span>
                  <span className="font-mono font-black text-danger-text">{formatCurrency(agentInfo?.balance || 0)}</span>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-withdraw-amount" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount (Coins)</Label>
                  <Input 
                    id="agent-withdraw-amount" 
                    type="number" 
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
                  disabled={isTransferring}
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
                  Set a new password for {agentInfo?.name}.
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
              agentInfo?.status === 'Active' 
                ? 'border-red-500/40 text-red-400 hover:bg-red-500/10' 
                : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
            }`}
          >
            {isTogglingStatus ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : (
              agentInfo?.status === 'Active' ? <UserX className="mr-1 h-3.5 w-3.5" /> : <UserCheck className="mr-1 h-3.5 w-3.5" />
            )}
            {agentInfo?.status === 'Active' ? 'Block' : 'Unblock'}
          </Button>
        </div>
      </div>

      {/* Stats Metric Strip (Ultra-Compact 3-Column Grid on Mobile) */}
      <div className="grid gap-1.5 sm:gap-3 grid-cols-3">
        <Card className="bg-card border border-border/80 p-2 sm:p-4 rounded-xl sm:rounded-2xl shadow-xs hover:border-emerald-500/30 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground truncate">
              Coins
            </span>
            <div className="hidden sm:flex p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              <Coins className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2">
            {isRefreshing ? (
              <div className="h-5 sm:h-7 w-16 sm:w-24 bg-secondary/80 rounded animate-pulse my-0.5" />
            ) : (
              <div className="text-xs sm:text-2xl font-mono font-black text-foreground tracking-tight truncate">
                {formatCurrency(agentInfo?.balance || 0)}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5 hidden sm:block">Available for allocation</p>
          </div>
        </Card>

        <Card className="bg-card border border-border/80 p-2 sm:p-4 rounded-xl sm:rounded-2xl shadow-xs hover:border-primary/30 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground truncate">
              Players
            </span>
            <div className="hidden sm:flex p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2">
            {isRefreshing ? (
              <div className="h-5 sm:h-7 w-10 sm:w-12 bg-secondary/80 rounded animate-pulse my-0.5" />
            ) : (
              <div className="text-xs sm:text-2xl font-mono font-black text-foreground tracking-tight">
                {players.length}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5 hidden sm:block">Sub-registered network</p>
          </div>
        </Card>

        <Card className="bg-card border border-border/80 p-2 sm:p-4 rounded-xl sm:rounded-2xl shadow-xs hover:border-amber-500/30 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground truncate">
              Status
            </span>
            <div className="hidden sm:flex p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2">
            <span className={`inline-flex items-center rounded-full px-1.5 sm:px-2.5 py-0.2 sm:py-0.5 text-[8px] sm:text-[10px] font-black uppercase ${
              agentInfo?.status === 'Active' ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
            }`}>
              {agentInfo?.status || 'Active'}
            </span>
            <p className="text-[10px] text-muted-foreground font-medium mt-1 hidden sm:block">Operational status</p>
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
                  const isPlayerOnline = player.isOnline && player.status === 'Active'
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
                              {player.name[0]?.toUpperCase()}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
                              isPlayerOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                            }`} />
                          </div>
                          <span className="font-extrabold text-xs truncate leading-tight">{player.name}</span>
                        </div>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.2 text-[9px] font-black shrink-0 ${
                          player.status === 'Active'
                            ? 'bg-success-bg text-success-text border border-emerald-500/20'
                            : 'bg-danger-bg text-danger-text border border-red-500/20'
                        }`}>
                          {player.status}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/30">
                        <span className="text-muted-foreground font-mono text-[10px] truncate">@{player.username}</span>
                        {isRefreshing ? (
                          <div className="h-3.5 w-12 bg-secondary/80 rounded animate-pulse shrink-0" />
                        ) : (
                          <span className="font-mono font-black text-foreground text-xs">{formatCurrency(player.balance)}</span>
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
                        {selectedPlayer.name[0]?.toUpperCase()}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
                        selectedPlayer.isOnline && selectedPlayer.status === 'Active' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                      }`} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <h3 className="text-xs sm:text-sm font-black text-foreground leading-tight truncate">
                          History of {selectedPlayer.name}
                        </h3>
                        <span className="text-[10px] font-mono text-muted-foreground bg-secondary/50 px-1.5 py-0.2 rounded font-bold">
                          {formatCurrency(selectedPlayer.balance)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-[10px] font-mono">
                        <span className="text-muted-foreground truncate">@{selectedPlayer.username}</span>
                        <span className="text-muted-foreground/60">&bull;</span>
                        {selectedPlayer.isOnline && selectedPlayer.status === 'Active' ? (
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
                            const isExpanded = !!expandedSpins[spin.id]
                            const singleCount = Object.keys(spin.singleBets || {}).length
                            const doubleCount = Object.keys(spin.doubleBets || {}).length
                            const tripleCount = Object.keys(spin.tripleBets || {}).length
                            const isWon = spin.win > 0

                            return (
                              <Card key={spin.id} className="p-3 bg-card border-border/70 rounded-xl space-y-2 shadow-xs">
                                {/* Card Header */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-2 min-w-0">
                                    <span className="font-mono text-xs font-black text-foreground">#{spin.id}</span>
                                    <span className="text-xs font-semibold text-muted-foreground truncate">{spin.game}</span>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black ${
                                      isWon ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
                                    }`}>
                                      {isWon ? 'WON' : 'LOST'}
                                    </span>
                                    <button
                                      onClick={() => toggleSpinExpand(spin.id)}
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
                                  <span className="font-mono">{spin.date}</span>
                                </div>

                                {/* Card Metrics Strip */}
                                <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-secondary/30 text-center text-xs">
                                  <div>
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Result</span>
                                    <span className="font-mono font-black text-primary bg-primary/10 px-1.5 py-0.2 rounded inline-block">
                                      {spin.resultNumber.toString().padStart(3, '0')}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Bet</span>
                                    <span className="font-mono font-black text-foreground">{formatCurrency(spin.bet)}</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Total Win</span>
                                    <span className={`font-mono font-black ${spin.win > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                                      {spin.win > 0 ? `+${formatCurrency(spin.win)}` : '-'}
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
                                          {Object.entries(spin.singleBets).map(([num, val]) => {
                                            const isWinning = spin.blackDigit !== null && num === spin.blackDigit.toString()
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
                                          {Object.entries(spin.doubleBets).map(([num, val]) => {
                                            const targetDouble = (spin.greenDigit !== null && spin.blackDigit !== null) 
                                              ? `${spin.greenDigit}${spin.blackDigit}` 
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
                                          {Object.entries(spin.tripleBets).map(([num, val]) => {
                                            const targetTriple = (spin.redDigit !== null && spin.greenDigit !== null && spin.blackDigit !== null) 
                                              ? `${spin.redDigit}${spin.greenDigit}${spin.blackDigit}` 
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
                                <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Spin ID</TableHead>
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
                                const isExpanded = !!expandedSpins[spin.id]
                                const singleCount = Object.keys(spin.singleBets || {}).length
                                const doubleCount = Object.keys(spin.doubleBets || {}).length
                                const tripleCount = Object.keys(spin.tripleBets || {}).length

                                return (
                                  <React.Fragment key={spin.id}>
                                    <TableRow className="border-border hover:bg-secondary/30 transition-colors">
                                      <TableCell className="p-2">
                                        <button
                                          onClick={() => toggleSpinExpand(spin.id)}
                                          className="p-1 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none transition-transform duration-200"
                                          style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                          aria-label={isExpanded ? "Collapse details" : "Expand details"}
                                        >
                                          <ChevronRight className="h-3.5 w-3.5" />
                                        </button>
                                      </TableCell>
                                      <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5">{spin.id}</TableCell>
                                      <TableCell className="text-[11px] font-semibold text-foreground p-2.5">{spin.game}</TableCell>
                                      <TableCell className="text-[11px] font-bold text-primary p-2.5">{spin.mode}</TableCell>
                                      <TableCell className="text-[11px] text-muted-foreground font-mono whitespace-nowrap p-2.5">{spin.date}</TableCell>
                                      <TableCell className="text-center p-2.5">
                                        <span className="font-mono font-black text-xs text-primary bg-primary/10 rounded-md px-2 py-0.5 inline-block">
                                          {spin.resultNumber.toString().padStart(3, '0')}
                                        </span>
                                      </TableCell>
                                      <TableCell className="text-right font-mono text-[11px] font-bold text-foreground p-2.5">
                                        {formatCurrency(spin.bet)}
                                      </TableCell>
                                      <TableCell className={`text-right font-mono text-[11px] font-bold p-2.5 ${spin.win > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                                        {spin.win > 0 ? `+${formatCurrency(spin.win)}` : '-'}
                                      </TableCell>
                                      <TableCell className="text-center p-2.5">
                                        <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black ${
                                          spin.status === 'WON' ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
                                        }`}>
                                          {spin.status}
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
                                                  {Object.entries(spin.singleBets).map(([num, val]) => {
                                                    const isWinning = spin.blackDigit !== null && num === spin.blackDigit.toString()
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
                                                  {Object.entries(spin.doubleBets).map(([num, val]) => {
                                                    const targetDouble = (spin.greenDigit !== null && spin.blackDigit !== null) 
                                                      ? `${spin.greenDigit}${spin.blackDigit}` 
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
                                                  {Object.entries(spin.tripleBets).map(([num, val]) => {
                                                    const targetTriple = (spin.redDigit !== null && spin.greenDigit !== null && spin.blackDigit !== null) 
                                                      ? `${spin.redDigit}${spin.greenDigit}${spin.blackDigit}` 
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
                                <TableCell className="text-[11px] text-muted-foreground p-2.5">{tx.date}</TableCell>
                                <TableCell className="text-[11px] p-2.5">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black uppercase ${
                                    tx.type === 'deposit'
                                      ? 'bg-success-bg text-success-text border border-emerald-500/20'
                                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {tx.type}
                                  </span>
                                </TableCell>
                                <TableCell className={`text-right font-mono text-[11px] font-extrabold p-2.5 ${
                                  tx.type === 'deposit' ? 'text-success-text' : 'text-amber-400'
                                }`}>
                                  {tx.type === 'deposit' ? `+${formatCurrency(tx.amount)}` : `-${formatCurrency(tx.amount)}`}
                                </TableCell>
                                <TableCell className="text-right font-mono text-[11px] font-bold text-foreground p-2.5">
                                  {formatCurrency(tx.balanceAfter)}
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
                            <span className={`font-mono font-black ${profitSummary.todaysPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {profitSummary.todaysPnl >= 0 ? '+' : ''}{formatCurrency(profitSummary.todaysPnl)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-muted-foreground uppercase block">Lifetime P/L</span>
                            <span className={`font-mono font-black ${profitSummary.lifetimePnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {profitSummary.lifetimePnl >= 0 ? '+' : ''}{formatCurrency(profitSummary.lifetimePnl)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-muted-foreground uppercase block">Total Bets</span>
                            <span className="font-mono font-bold text-foreground">{formatCurrency(profitSummary.totalVolume)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-muted-foreground uppercase block">House Margin</span>
                            <span className={`font-mono font-black ${profitSummary.netMarginPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {profitSummary.netMarginPct.toFixed(1)}%
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
                                  {p.totalPlays}
                                </TableCell>
                                <TableCell className="py-2 text-right font-mono text-xs text-foreground font-bold">
                                  {formatCurrency(p.totalBets)}
                                </TableCell>
                                <TableCell className="py-2 text-right font-mono text-xs text-amber-500 font-bold">
                                  {formatCurrency(p.totalWins)}
                                </TableCell>
                                <TableCell className={`py-2 text-right font-mono text-xs font-black ${p.netPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {p.netPnl >= 0 ? '+' : ''}{formatCurrency(p.netPnl)}
                                </TableCell>
                                <TableCell className={`py-2 text-right font-mono text-xs font-black ${p.marginPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {p.marginPct.toFixed(1)}%
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
