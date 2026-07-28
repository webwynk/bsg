"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useParams, useRouter } from 'next/navigation'
import { 
  Plus, Loader2, ArrowUpRight, ArrowDownRight, UserX, UserCheck, KeyRound, 
  ArrowLeft, Eye, EyeOff, ChevronRight, Search, Users, Gamepad2, Coins, 
  Calendar as CalendarIcon, Filter, Activity, TrendingUp, TrendingDown, RefreshCw, X,
  CheckCircle2, AlertCircle, ShieldCheck
} from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { createPlayerAction, getPlayersAction, togglePlayerStatusAction, getPlayerDetailHistoryAction, resetPlayerPasswordAction } from '@/app/agent/players/actions'
import { transferPointsAction } from '@/app/superadmin/agents/actions'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function PlayersPage() {
  const [players, setPlayers] = React.useState<Array<{ 
    id: string; 
    name: string; 
    username: string; 
    balance: number; 
    status: string; 
    isOnline?: boolean;
    gamePlays: number 
  }>>([])
  const [selectedPlayer, setSelectedPlayer] = React.useState<typeof players[0] | null>(null)
  const [activeTab, setActiveTab] = React.useState<'games' | 'points'>('games')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [isLoadingPlayers, setIsLoadingPlayers] = React.useState(true)
  const params = useParams()
  const router = useRouter()
  const urlSlug = Array.isArray(params?.slug) ? params.slug[0] : (params?.slug || '')

  const [usernameInput, setUsernameInput] = React.useState('')
  const isUsernameTouched = usernameInput.length > 0
  const isUsernameValid = React.useMemo(() => /^[a-zA-Z0-9]{3,20}$/.test(usernameInput), [usernameInput])

  // Mobile layout state: show list or details pane
  const [showMobileDetail, setShowMobileDetail] = React.useState(false)

  // History data states
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

  const [pointsHistory, setPointsHistory] = React.useState<Array<{
    id: string
    type: 'deposit' | 'withdraw'
    amount: number
    balanceAfter: number
    date: string
  }>>([])
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false)

  // Scope state for Performance Summary Bar: 'today' | 'lifetime'
  const [statsScope, setStatsScope] = React.useState<'today' | 'lifetime'>('today')

  // Filter states
  const [filterDate, setFilterDate] = React.useState<Date | undefined>(undefined)
  const [filterOutcome, setFilterOutcome] = React.useState<'all' | 'WON' | 'LOST'>('all')
  const [filterMode, setFilterMode] = React.useState<'all' | 'SINGLE' | 'DOUBLE' | 'TRIPLE'>('all')

  // Pagination states
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
      if (filterDate) {
        const filterDateStr = filterDate.toLocaleDateString('en-US', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        })
        if (!spin.date.includes(filterDateStr)) return false
      }

      if (filterOutcome !== 'all' && spin.status !== filterOutcome) {
        return false
      }

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

  // Create Player modal state
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)

  // Point transfer state
  const [activeTransferModal, setActiveTransferModal] = React.useState<'deposit' | 'withdraw' | null>(null)
  const [transferAmount, setTransferAmount] = React.useState('')
  const [isTransferring, setIsTransferring] = React.useState(false)
  const [transferError, setTransferError] = React.useState<string | null>(null)

  // Status toggle state
  const [isTogglingStatus, setIsTogglingStatus] = React.useState(false)

  // Password reset state
  const [isPasswordResetOpen, setIsPasswordResetOpen] = React.useState(false)
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [isResettingPassword, setIsResettingPassword] = React.useState(false)
  const [resetPasswordError, setResetPasswordError] = React.useState<string | null>(null)
  const [resetPasswordSuccess, setResetPasswordSuccess] = React.useState<string | null>(null)

  const [showCreatePassword, setShowCreatePassword] = React.useState(false)
  const [showNewPassword, setShowNewPassword] = React.useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false)

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
    }).catch(() => setIsLoadingHistory(false))
  }, [])

  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [countdown, setCountdown] = React.useState(90)
  // Stable ref — tracks selected player ID without being a useCallback dependency
  const selectedPlayerIdRef = React.useRef<string | null>(null)

  const loadPlayers = React.useCallback((opts?: { silent?: boolean; reloadHistory?: boolean }) => {
    const silent = opts?.silent ?? false
    const reloadHistory = opts?.reloadHistory ?? false
    if (!silent) setIsRefreshing(true)
    getPlayersAction().then((res) => {
      if (!silent) setIsRefreshing(false)
      setIsLoadingPlayers(false)
      if (res.players) {
        setPlayers(res.players)
        // If URL has a username slug (e.g. /agent/players/player01), select that player
        if (urlSlug) {
          const matchBySlug = res.players.find(p => p.username.toLowerCase() === urlSlug.toLowerCase())
          if (matchBySlug) {
            selectedPlayerIdRef.current = matchBySlug.id
            setSelectedPlayer(matchBySlug)
            if (reloadHistory) loadPlayerHistory(matchBySlug.id)
            return
          }
        }
        const targetId = selectedPlayerIdRef.current
        if (targetId) {
          const updated = res.players.find(p => p.id === targetId)
          if (updated) {
            setSelectedPlayer(updated)
            if (reloadHistory) loadPlayerHistory(updated.id)
          }
        } else if (res.players.length > 0) {
          selectedPlayerIdRef.current = res.players[0].id
          setSelectedPlayer(res.players[0])
          loadPlayerHistory(res.players[0].id)
        }
      }
    }).catch(() => {
      if (!silent) setIsRefreshing(false)
      setIsLoadingPlayers(false)
    })
  }, [loadPlayerHistory, urlSlug]) // Stable — no selectedPlayer?.id dep, no interval leak

  React.useEffect(() => {
    loadPlayers({ reloadHistory: true }) // initial load: players + history

    // 1s countdown tick — UI only, no DB fetch
    const countdownTick = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? 90 : prev - 1))
    }, 1000)

    // 90s data interval — silent, list only (no history cascade)
    const dataInterval = setInterval(() => {
      setCountdown(90)
      loadPlayers({ silent: true })
    }, 90000)

    return () => {
      clearInterval(countdownTick)
      clearInterval(dataInterval)
    }
  }, [loadPlayers])

  const handleManualRefresh = async () => {
    setCountdown(90)
    loadPlayers({ reloadHistory: true })
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
    setFilterDate(undefined)
    setFilterOutcome('all')
    setFilterMode('all')
    setGamesPage(1)
    setPointsPage(1)
    loadPlayerHistory(player.id)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/agent/players/${player.username}`)
    }
  }

  const handleCreatePlayer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    const formData = new FormData(e.currentTarget)
    const username = formData.get('username') as string

    const res = await createPlayerAction(formData)

    setIsLoading(false)
    if (res.error) {
      setErrorMessage(res.error)
    } else {
      setSuccessMessage(`Player "@${username}" registered successfully!`)
      loadPlayers({ reloadHistory: true })
      setTimeout(() => {
        setIsOpen(false)
        setSuccessMessage(null)
      }, 1200)
    }
  }

  const handleTransferPoints = async (type: 'deposit' | 'withdraw') => {
    if (!selectedPlayer) return
    const amountNum = parseFloat(transferAmount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setTransferError('Please enter a valid coin amount greater than 0.')
      return
    }

    setIsTransferring(true)
    setTransferError(null)

    const res = await transferPointsAction(selectedPlayer.id, amountNum, type)

    setIsTransferring(false)
    if (res.error) {
      setTransferError(res.error)
    } else {
      setActiveTransferModal(null)
      setTransferAmount('')
      loadPlayers({ reloadHistory: true })
    }
  }

  const handleToggleStatus = async () => {
    if (!selectedPlayer) return
    const nextStatus = selectedPlayer.status === 'Active' ? 'Disabled' : 'Active'
    setIsTogglingStatus(true)

    const res = await togglePlayerStatusAction(selectedPlayer.id, nextStatus)

    setIsTogglingStatus(false)
    if (!res.error) {
      loadPlayers({ reloadHistory: true })
    }
  }

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedPlayer) return
    if (newPassword.length < 6) {
      setResetPasswordError('Password must be at least 6 characters long.')
      return
    }
    if (newPassword !== confirmPassword) {
      setResetPasswordError('Passwords do not match.')
      return
    }

    setIsResettingPassword(true)
    setResetPasswordError(null)

    const res = await resetPlayerPasswordAction(selectedPlayer.id, newPassword)

    setIsResettingPassword(false)
    if (res.error) {
      setResetPasswordError(res.error)
    } else {
      setResetPasswordSuccess('Password updated successfully!')
      setTimeout(() => {
        setIsPasswordResetOpen(false)
        setNewPassword('')
        setConfirmPassword('')
        setResetPasswordSuccess(null)
      }, 1200)
    }
  }

  const filteredPlayers = players.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.username.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto px-2 sm:px-4 md:px-0 pb-12">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <div className="p-1 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Users className="h-4 w-4" />
            </div>
            <h1 className="text-lg sm:text-2xl font-black tracking-tight text-foreground">
              Player Accounts
            </h1>
            <span className="inline-flex items-center px-2 py-0.2 rounded-full text-[10px] font-extrabold bg-primary/10 text-primary border border-primary/20">
              {players.length} Total
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-[11px] sm:text-xs hidden sm:block">
            Manage player balances, reset passwords, track gameplay history and cashier points.
          </p>
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Auto-Sync ({countdown}s)
          </span>
          <Button onClick={handleManualRefresh} variant="outline" size="sm" className="h-8 sm:h-10 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border flex-1 sm:flex-none">
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          {/* Add Player Modal */}
          <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open)
            if (!open) {
              setUsernameInput('')
              setErrorMessage(null)
              setSuccessMessage(null)
            }
          }}>
            <DialogTrigger className="flex-1 sm:flex-none h-8 sm:h-10 px-3 sm:px-4 font-extrabold bg-primary text-primary-foreground hover:bg-primary/95 shadow-sm cursor-pointer rounded-xl text-[11px] sm:text-xs flex items-center justify-center transition-all duration-200">
              <Plus className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Add Player
            </DialogTrigger>
          <DialogContent className="sm:max-w-[430px] bg-card border-border/80 text-foreground shadow-2xl rounded-2xl p-0 overflow-hidden">
            <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-transparent p-5 border-b border-border/60">
              <div className="flex items-center space-x-2.5">
                <div className="p-2.5 rounded-xl bg-primary/20 text-primary border border-primary/30 shrink-0">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-black tracking-tight">Register New Player</DialogTitle>
                  <DialogDescription className="text-muted-foreground text-xs mt-0.5">
                    Create a new player account for your agent sub-network.
                  </DialogDescription>
                </div>
              </div>
            </div>

            <form onSubmit={handleCreatePlayer} className="p-5 space-y-4">
              {errorMessage && (
                <div className="p-3 text-xs font-bold rounded-xl bg-danger-bg text-danger-text border border-red-500/20 flex items-center shadow-xs">
                  <AlertCircle className="h-4 w-4 mr-2 text-red-500 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
              {successMessage && (
                <div className="p-3 text-xs font-bold rounded-xl bg-success-bg text-success-text border border-emerald-500/20 flex items-center shadow-xs">
                  <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500 shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Player Full Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g. Rahul Sharma"
                  className="h-10 bg-background/70 border-border text-foreground text-xs rounded-xl focus:border-primary/50"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="username" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Player Username
                  </Label>
                  <span className="text-[10px] text-muted-foreground font-mono">Only letters & numbers</span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-muted-foreground/70 font-mono font-bold">@</span>
                  <Input
                    id="username"
                    name="username"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    placeholder="player01"
                    className={`pl-8 pr-9 h-10 bg-background/70 text-foreground text-xs rounded-xl font-mono transition-all ${
                      isUsernameTouched
                        ? isUsernameValid
                          ? 'border-emerald-500/80 focus:border-emerald-500'
                          : 'border-red-500/80 focus:border-red-500'
                        : 'border-border focus:border-primary/50'
                    }`}
                    required
                  />
                  {isUsernameTouched && (
                    <div className="absolute right-3 top-2.5">
                      {isUsernameValid ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  )}
                </div>
                {isUsernameTouched && !isUsernameValid && (
                  <p className="text-[10px] font-bold text-red-500 flex items-center mt-1">
                    <AlertCircle className="h-3 w-3 mr-1 shrink-0" />
                    No symbols allowed. Use 3-20 letters/numbers only (e.g. player01, player03)
                  </p>
                )}
                {isUsernameTouched && isUsernameValid && (
                  <p className="text-[10px] font-bold text-emerald-500 flex items-center mt-1">
                    <CheckCircle2 className="h-3 w-3 mr-1 shrink-0" />
                    Valid username format: @{usernameInput}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showCreatePassword ? "text" : "password"}
                    placeholder="Min 6 characters"
                    className="h-10 bg-background/70 border-border text-foreground pr-10 text-xs rounded-xl"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword(!showCreatePassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
                    aria-label={showCreatePassword ? "Hide password" : "Show password"}
                  >
                    {showCreatePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <DialogFooter className="pt-3">
                <Button 
                  type="submit" 
                  disabled={isLoading || (isUsernameTouched && !isUsernameValid)} 
                  className="w-full h-10 font-black text-xs rounded-xl shadow-md cursor-pointer bg-primary hover:bg-primary/90 transition-all"
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isLoading ? 'Registering Player...' : 'Create Player Account'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Compact Grid Layout (3 cols left vs 9 cols right) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 min-h-[600px]">
        {/* --- LEFT SIDE: COMPACT PLAYERS LIST (md:col-span-3) --- */}
        <div className={`md:col-span-3 space-y-2.5 ${showMobileDetail ? 'hidden md:block' : 'block'}`}>
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground/70" />
            <Input 
              placeholder="Search players..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-card border-border/80 text-foreground text-xs rounded-xl focus:border-primary/50 shadow-xs" 
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-[10px] text-muted-foreground hover:text-foreground font-bold"
              >
                Clear
              </button>
            )}
          </div>

          {/* Compact Player Cards List Container */}
          <div className="space-y-1.5 max-h-[620px] overflow-y-auto pr-0.5 custom-scrollbar">
            {isLoadingPlayers ? (
              [1, 2, 3, 4, 5].map((i) => (
                <Card key={i} className="p-2.5 border-border/60 bg-card/60 animate-pulse space-y-1.5 rounded-xl">
                  <div className="flex justify-between items-center">
                    <div className="h-3.5 bg-secondary/80 rounded w-1/3" />
                    <div className="h-3.5 bg-secondary/60 rounded-full w-12" />
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="h-3 bg-secondary/60 rounded w-1/4" />
                    <div className="h-3.5 bg-secondary/80 rounded w-16" />
                  </div>
                </Card>
              ))
            ) : filteredPlayers.length > 0 ? (
              filteredPlayers.map((player) => {
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
                      {isRefreshing || isLoadingPlayers ? (
                        <div className="h-3.5 w-12 bg-secondary/80 rounded animate-pulse shrink-0" />
                      ) : (
                        <span className="font-mono font-black text-foreground text-xs">{formatCurrency(player.balance)}</span>
                      )}
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground font-medium bg-card rounded-xl border border-border">
                No players found.
              </div>
            )}
          </div>
        </div>

        {/* --- RIGHT SIDE: MAIN PLAYER DETAILS & HISTORY (md:col-span-9) --- */}
        <div className={`md:col-span-9 space-y-3 ${showMobileDetail ? 'block' : 'hidden md:block'}`}>
          {selectedPlayer ? (
            <div className="space-y-3">
              {/* Selected Player Header Card (ULTRA COMPACT) */}
              <Card className="border-border/80 bg-card p-3 sm:p-3.5 rounded-2xl shadow-md space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  {/* Player Avatar, Name & Live Sync Status */}
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <button
                      onClick={() => setShowMobileDetail(false)}
                      className="md:hidden p-1.5 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 focus:outline-none shrink-0"
                      aria-label="Back to players list"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>

                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-sm">
                        {selectedPlayer.name[0]?.toUpperCase()}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
                        selectedPlayer.isOnline && selectedPlayer.status === 'Active' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                      }`} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <h2 className="text-sm sm:text-base font-black text-foreground truncate">{selectedPlayer.name}</h2>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black shrink-0 ${
                          selectedPlayer.status === 'Active'
                            ? 'bg-success-bg text-success-text border border-emerald-500/20'
                            : 'bg-danger-bg text-danger-text border border-red-500/20'
                        }`}>
                          {selectedPlayer.status}
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

                  {/* Balance Summary Pill */}
                  <div className="bg-secondary/40 border border-border/60 px-3 py-1.5 rounded-xl flex items-center justify-between sm:justify-end space-x-2.5 shrink-0">
                    <div className="text-left sm:text-right">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">
                        Coins Balance
                      </span>
                      {isRefreshing || isLoadingPlayers ? (
                        <div className="h-5 w-16 bg-secondary/80 rounded animate-pulse mt-0.5" />
                      ) : (
                        <span className="text-base font-mono font-black text-foreground">
                          {formatCurrency(selectedPlayer.balance)}
                        </span>
                      )}
                    </div>
                    <div className="p-1 rounded-lg bg-primary/10 text-primary">
                      <Coins className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </div>

                {/* Quick Actions Bar (Compact Buttons: h-8) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-2 border-t border-border/50">
                  {/* Deposit Modal */}
                  <Dialog open={activeTransferModal === 'deposit'} onOpenChange={(open) => {
                    setActiveTransferModal(open ? 'deposit' : null)
                    setTransferAmount('')
                    setTransferError(null)
                  }}>
                    <DialogTrigger className="w-full h-8 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold shadow-sm cursor-pointer rounded-lg text-[11px] flex items-center justify-center border-0">
                      <ArrowUpRight className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Deposit Coins
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
                      <DialogHeader>
                        <DialogTitle className="font-black text-lg">Deposit Coins</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                          Issue cashier coins to {selectedPlayer.name} (@{selectedPlayer.username}).
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 py-2">
                        {transferError && (
                          <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                            {transferError}
                          </div>
                        )}
                        <div className="space-y-1">
                          <Label htmlFor="deposit-amount" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Amount (Coins)
                          </Label>
                          <Input 
                            id="deposit-amount" 
                            type="number" 
                            placeholder="e.g. 500" 
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            className="h-10 bg-background border-border text-foreground text-xs rounded-lg" 
                          />
                        </div>
                      </div>
                      <DialogFooter>
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
                  <Dialog open={activeTransferModal === 'withdraw'} onOpenChange={(open) => {
                    setActiveTransferModal(open ? 'withdraw' : null)
                    setTransferAmount('')
                    setTransferError(null)
                  }}>
                    <DialogTrigger className="w-full h-8 border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 font-extrabold cursor-pointer rounded-lg text-[11px] flex items-center justify-center bg-transparent">
                      <ArrowDownRight className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Withdraw
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
                      <DialogHeader>
                        <DialogTitle className="font-black text-lg">Withdraw Coins</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                          Deduct cashier coins from {selectedPlayer.name} (@{selectedPlayer.username}).
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 py-2">
                        {transferError && (
                          <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                            {transferError}
                          </div>
                        )}
                        <div className="space-y-1">
                          <Label htmlFor="withdraw-amount" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Amount (Coins)
                          </Label>
                          <Input 
                            id="withdraw-amount" 
                            type="number" 
                            placeholder="e.g. 200" 
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            className="h-10 bg-background border-border text-foreground text-xs rounded-lg" 
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          onClick={() => handleTransferPoints('withdraw')} 
                          disabled={isTransferring}
                          className="w-full h-10 bg-destructive text-destructive-foreground hover:bg-destructive/90 font-extrabold cursor-pointer rounded-lg text-xs"
                        >
                          {isTransferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {isTransferring ? 'Processing...' : 'Confirm Withdrawal'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Reset Password Modal */}
                  <Dialog 
                    open={isPasswordResetOpen}
                    onOpenChange={(open) => {
                      setIsPasswordResetOpen(open)
                      setNewPassword('')
                      setConfirmPassword('')
                      setResetPasswordError(null)
                      setResetPasswordSuccess(null)
                      setShowNewPassword(false)
                      setShowConfirmPassword(false)
                    }}
                  >
                    <DialogTrigger className="w-full h-8 border border-primary/40 text-primary hover:bg-primary/10 cursor-pointer text-[11px] font-extrabold rounded-lg flex items-center justify-center bg-transparent">
                      <KeyRound className="mr-1 h-3.5 w-3.5" /> Password
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
                      <DialogHeader>
                        <DialogTitle className="font-black text-lg">Reset Player Password</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                          Set a new password for {selectedPlayer.name}.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleResetPassword} className="space-y-3 py-2">
                        {resetPasswordError && (
                          <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                            {resetPasswordError}
                          </div>
                        )}
                        {resetPasswordSuccess && (
                          <div className="p-2.5 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20">
                            {resetPasswordSuccess}
                          </div>
                        )}
                        <div className="space-y-1">
                          <Label htmlFor="new-password text-[10px]">New Password</Label>
                          <div className="relative">
                            <Input 
                              id="new-password" 
                              type={showNewPassword ? "text" : "password"} 
                              placeholder="At least 6 characters" 
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="h-10 w-full bg-background border-border text-foreground pr-10 text-xs rounded-lg" 
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
                            >
                              {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="confirm-password text-[10px]">Confirm Password</Label>
                          <div className="relative">
                            <Input 
                              id="confirm-password" 
                              type={showConfirmPassword ? "text" : "password"} 
                              placeholder="Confirm new password" 
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              className="h-10 w-full bg-background border-border text-foreground pr-10 text-xs rounded-lg" 
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
                            >
                              {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>

                        <DialogFooter className="pt-2">
                          <Button 
                            type="submit" 
                            disabled={isResettingPassword}
                            className="w-full h-10 font-extrabold cursor-pointer text-xs rounded-lg"
                          >
                            {isResettingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {isResettingPassword ? 'Updating Password...' : 'Save New Password'}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>

                  {/* Status Toggle Button */}
                  <Button
                    onClick={handleToggleStatus}
                    disabled={isTogglingStatus}
                    variant="outline"
                    className={`w-full h-8 font-extrabold cursor-pointer rounded-lg text-[11px] flex items-center justify-center ${
                      selectedPlayer.status === 'Active'
                        ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                        : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                    }`}
                  >
                    {isTogglingStatus ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : (
                      selectedPlayer.status === 'Active' ? <UserX className="mr-1 h-3.5 w-3.5" /> : <UserCheck className="mr-1 h-3.5 w-3.5" />
                    )}
                    {selectedPlayer.status === 'Active' ? 'Disable Player' : 'Activate Player'}
                  </Button>
                </div>
              </Card>

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

              {/* History Section Container with Filter Toolbar */}
              <Card className="border-border/80 bg-card rounded-2xl overflow-hidden shadow-md">
                {/* Filter Toolbar (Date Picker + Quick Filters) */}
                <div className="p-3 border-b border-border/60 bg-secondary/10 flex flex-wrap items-center justify-between gap-2.5">
                  {/* Left Side: Tabs */}
                  <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5">
                    <button
                      onClick={() => setActiveTab('games')}
                      className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
                        activeTab === 'games' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Gamepad2 className="h-3.5 w-3.5 text-primary" />
                      <span>Game Plays</span>
                      <span className="text-[10px] text-muted-foreground">({filteredGames.length})</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('points')}
                      className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
                        activeTab === 'points' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Coins className="h-3.5 w-3.5 text-amber-400" />
                      <span>Coins History</span>
                      <span className="text-[10px] text-muted-foreground">({filteredPoints.length})</span>
                    </button>
                  </div>

                  {/* Right Side: Date Picker & Quick Filter Pills */}
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

                    {/* Date Picker Popover */}
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
                        size="sm"
                        onClick={() => setFilterDate(undefined)}
                        className="h-8 px-2 text-[10px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
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

                {/* Tab Content Display */}
                <div className="overflow-hidden">
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
                                      spin.status === 'WON' ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
                                    }`}>
                                      {spin.status}
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

                                    {/* Expanded Desktop Panel */}
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
                  ) : (
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
                        No coin transactions recorded for the selected filter.
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
