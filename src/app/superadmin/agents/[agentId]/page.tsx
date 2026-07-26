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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Users, Coins, Activity, CalendarIcon, ArrowUpRight, ArrowDownRight, Loader2, UserX, UserCheck, Key, Eye, EyeOff, ChevronRight } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { getAgentDetailAction, transferPointsAction, toggleAgentStatusAction, updateAgentPasswordAction } from '../actions'
import { getPlayerDetailHistoryAction } from '@/app/agent/players/actions'

interface Props {
  params: React.Usable<{ agentId: string }>
}

export default function AgentDetailPage({ params }: Props) {
  const { agentId } = React.use(params)
  
  const [agentInfo, setAgentInfo] = React.useState<{ id: string; name: string; username: string; balance: number; status: string } | null>(null)
  const [players, setPlayers] = React.useState<Array<{ id: string; name: string; username: string; balance: number; status: string; gamePlays: number }>>([])
  const [selectedPlayer, setSelectedPlayer] = React.useState<typeof players[0] | null>(null)
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
  const [activeTab, setActiveTab] = React.useState<'games' | 'points'>('games')
  const [filterDate, setFilterDate] = React.useState<Date | undefined>(undefined)

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
  const itemsPerPage = 4

  const loadPlayerHistory = React.useCallback((playerId: string) => {
    setIsLoadingHistory(true)
    getPlayerDetailHistoryAction(playerId).then((res) => {
      setIsLoadingHistory(false)
      if (res) {
        setGamePlays(res.gamePlays)
        setPointsHistory(res.pointsHistory)
      }
    })
  }, [])

  const loadAgentDetails = React.useCallback(() => {
    getAgentDetailAction(agentId).then((res) => {
      if (res.agent) {
        setAgentInfo(res.agent)
      }
      if (res.players) {
        setPlayers(res.players)
        if (res.players.length > 0 && !selectedPlayer) {
          setSelectedPlayer(res.players[0])
          loadPlayerHistory(res.players[0].id)
        }
      }
    })
  }, [agentId, selectedPlayer, loadPlayerHistory])

  React.useEffect(() => {
    loadAgentDetails()
  }, [])

  const handleSelectPlayer = (player: typeof players[0]) => {
    if (selectedPlayer?.id === player.id) return
    setSelectedPlayer(player)
    setIsLoadingHistory(true)
    setGamePlays([])
    setPointsHistory([])
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
      setPasswordSuccess('Password updated successfully!')
      setNewPassword('')
      setTimeout(() => {
        setIsPasswordModalOpen(false)
        setPasswordSuccess(null)
      }, 1500)
    }
  }

  const handleTransferPoints = async (type: 'deposit' | 'withdraw') => {
    const amountNum = parseFloat(transferAmount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setTransferError('Please enter a valid positive amount.')
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
      if (res.newBalance !== undefined && agentInfo) {
        setAgentInfo({ ...agentInfo, balance: res.newBalance })
      }
      loadAgentDetails()
    }
  }

  const totalGamesPages = Math.ceil(gamePlays.length / itemsPerPage) || 1
  const paginatedGames = gamePlays.slice((gamesPage - 1) * itemsPerPage, gamesPage * itemsPerPage)

  const totalPointsPages = Math.ceil(pointsHistory.length / itemsPerPage) || 1
  const paginatedPoints = pointsHistory.slice((pointsPage - 1) * itemsPerPage, pointsPage * itemsPerPage)

  const handleClearFilter = () => {
    setFilterDate(undefined)
    setGamesPage(1)
    setPointsPage(1)
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <Link href="/superadmin/agents" className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              {agentInfo ? agentInfo.name : 'Agent Details'}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm flex items-center space-x-2">
              <span className="font-semibold text-foreground">@{agentInfo ? agentInfo.username : '...'}</span>
              <span>&bull;</span>
              <span className="font-mono text-xs text-muted-foreground">ID: {agentId}</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2 shrink-0 flex-wrap gap-y-2">
          {/* Deposit Modal */}
          <Dialog
            open={activeTransferModal === 'deposit'}
            onOpenChange={(open) => {
              setActiveTransferModal(open ? 'deposit' : null)
              setTransferAmount('')
              setTransferError(null)
            }}
          >
            <DialogTrigger className={buttonVariants({ variant: "outline", className: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer font-bold text-xs" })}>
              <ArrowUpRight className="mr-1.5 h-4 w-4" /> Deposit Coins
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
              <DialogHeader>
                <DialogTitle>Issue Coins to Agent</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Add coins to {agentInfo?.name}&apos;s account.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {transferError && (
                  <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                    {transferError}
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Coins:</span>
                  <span className="font-bold text-success-text">{formatCurrency(agentInfo?.balance || 0)}</span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-deposit-amount">Amount (Coins)</Label>
                  <Input 
                    id="agent-deposit-amount" 
                    type="number" 
                    placeholder="50000" 
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="bg-background border-border text-foreground text-lg" 
                  />
                </div>
              </div>
              <DialogFooter>
                <Button 
                  onClick={() => handleTransferPoints('deposit')} 
                  disabled={isTransferring}
                  className="w-full bg-success text-white hover:bg-success/90 font-bold cursor-pointer"
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
            <DialogTrigger className={buttonVariants({ variant: "outline", className: "border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer font-bold text-xs" })}>
              <ArrowDownRight className="mr-1.5 h-4 w-4" /> Withdraw Coins
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
              <DialogHeader>
                <DialogTitle>Withdraw Coins from Agent</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Recall coins from {agentInfo?.name}&apos;s account.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {transferError && (
                  <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                    {transferError}
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Coins:</span>
                  <span className="font-bold text-danger-text">{formatCurrency(agentInfo?.balance || 0)}</span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-withdraw-amount">Amount (Coins)</Label>
                  <Input 
                    id="agent-withdraw-amount" 
                    type="number" 
                    placeholder="50000" 
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="bg-background border-border text-foreground text-lg" 
                  />
                </div>
              </div>
              <DialogFooter>
                <Button 
                  onClick={() => handleTransferPoints('withdraw')} 
                  disabled={isTransferring}
                  className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold cursor-pointer"
                >
                  {isTransferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isTransferring ? 'Processing...' : 'Confirm Withdrawal'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Change Password Modal */}
          <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
            <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer font-bold text-xs" })}>
              <Key className="mr-1.5 h-3.5 w-3.5" /> Change Password
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
              <DialogHeader>
                <DialogTitle>Reset Agent Password</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Set a new login password for {agentInfo?.name} (@{agentInfo?.username}).
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleUpdatePassword}>
                <div className="grid gap-4 py-4">
                  {passwordError && (
                    <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                      {passwordError}
                    </div>
                  )}
                  {passwordSuccess && (
                    <div className="p-3 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20">
                      {passwordSuccess}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <div className="relative">
                      <Input 
                        id="new-password" 
                        type={showPassword ? "text" : "password"} 
                        placeholder="••••••••" 
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-background border-border text-foreground pr-10"
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isUpdatingPassword} className="w-full font-bold cursor-pointer">
                    {isUpdatingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isUpdatingPassword ? 'Updating Password...' : 'Update Password'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Block / Unblock Agent Button */}
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleToggleAgentStatus}
            disabled={isTogglingStatus}
            className={`text-xs font-bold cursor-pointer ${
              agentInfo?.status === 'Active' 
                ? 'border-red-500/30 text-red-500 hover:bg-red-500/10' 
                : 'border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10'
            }`}
          >
            {isTogglingStatus ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : (
              agentInfo?.status === 'Active' ? <UserX className="mr-1.5 h-3.5 w-3.5" /> : <UserCheck className="mr-1.5 h-3.5 w-3.5" />
            )}
            {agentInfo?.status === 'Active' ? 'Block Agent' : 'Unblock Agent'}
          </Button>
        </div>
      </div>

      {/* Stats Bento Grid */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Coins Balance</span>
            <Coins className="h-5 w-5 text-emerald-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-2xl font-bold font-mono tracking-tight">{formatCurrency(agentInfo?.balance || 0)}</div>
            <p className="text-xs text-muted-foreground mt-2">Available for player allocation</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active Players</span>
            <Users className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-2xl font-bold font-mono tracking-tight">{players.length}</div>
            <p className="text-xs text-muted-foreground mt-2">Players registered under this agency</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</span>
            <Activity className="h-5 w-5 text-amber-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${
              agentInfo?.status === 'Active' ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'
            }`}>
              {agentInfo?.status || 'Active'}
            </span>
            <p className="text-xs text-muted-foreground mt-2">Operational state</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Layout */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-12">
        {/* Left Bento */}
        <Card className="lg:col-span-5 bg-card border-border shadow-sm rounded-xl overflow-hidden flex flex-col h-[580px]">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold text-foreground">Current Agent Players</CardTitle>
                <CardDescription className="text-muted-foreground text-xs">
                  Active directory under this agency.
                </CardDescription>
              </div>
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                {players.length} total
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto flex-1">
            {players.length > 0 ? (
              <div className="divide-y divide-border/60">
                {players.map((player) => (
                  <div
                    key={player.id}
                    onClick={() => {
                      handleSelectPlayer(player)
                      setGamesPage(1)
                      setPointsPage(1)
                    }}
                    className={`p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-secondary/40 transition-all duration-150 ${
                      selectedPlayer?.id === player.id ? 'bg-secondary/80 border-l-4 border-primary' : ''
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="font-bold text-sm text-foreground truncate">{player.name}</p>
                        <span className={`w-1.5 h-1.5 rounded-full ${player.status === 'Active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      </div>
                      <span className="text-xs text-muted-foreground">@{player.username}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm font-mono tracking-tight">{formatCurrency(player.balance)} Coins</p>
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                        {player.gamePlays} plays
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground text-xs font-medium">
                No players registered under this agent yet.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Bento */}
        <Card className="lg:col-span-7 bg-card border-border shadow-sm rounded-xl overflow-hidden flex flex-col h-[580px]">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-3">
                <div className="min-w-0">
                  <CardTitle className="text-lg font-bold text-foreground truncate">
                    {selectedPlayer ? `History of ${selectedPlayer.name}` : 'Player History'}
                  </CardTitle>
                  <CardDescription className="text-muted-foreground text-xs truncate">
                    {selectedPlayer ? `@${selectedPlayer.username} • Coins: ${formatCurrency(selectedPlayer.balance)}` : 'Select a player from the directory'}
                  </CardDescription>
                </div>
              </div>
              
              <div className="flex items-center space-x-2 shrink-0">
                <Popover>
                  <PopoverTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "w-[130px] justify-start text-left font-normal border-border bg-background cursor-pointer text-xs" })}>
                    <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    {filterDate ? filterDate.toISOString().split('T')[0] : <span>Filter Date</span>}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-border bg-card">
                    <Calendar
                      mode="single"
                      selected={filterDate}
                      onSelect={(d) => {
                        setFilterDate(d)
                        setGamesPage(1)
                        setPointsPage(1)
                      }}
                    />
                  </PopoverContent>
                </Popover>
                {filterDate && (
                  <Button variant="ghost" size="sm" onClick={handleClearFilter} className="text-xs text-muted-foreground hover:text-foreground h-7 px-2">
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <div className="px-4 py-2 border-b border-border/60 bg-secondary/20 flex space-x-2">
            <button
              onClick={() => setActiveTab('games')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1 ${
                activeTab === 'games' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>Game Plays</span>
              {isLoadingHistory ? (
                <span className="inline-block h-3.5 w-5 rounded bg-secondary/80 animate-pulse" />
              ) : (
                <span>({gamePlays.length})</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('points')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1 ${
                activeTab === 'points' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>Coins History</span>
              {isLoadingHistory ? (
                <span className="inline-block h-3.5 w-5 rounded bg-secondary/80 animate-pulse" />
              ) : (
                <span>({pointsHistory.length})</span>
              )}
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col justify-between">
            {isLoadingHistory ? (
              <div className="p-6 space-y-4 flex-1">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-4 p-3 rounded-lg bg-secondary/20 animate-pulse border border-border/40">
                    <div className="h-4 bg-secondary/80 rounded w-1/4" />
                    <div className="h-4 bg-secondary/60 rounded w-1/3" />
                    <div className="h-4 bg-secondary/70 rounded w-1/6" />
                    <div className="h-4 bg-secondary/80 rounded w-1/5" />
                  </div>
                ))}
              </div>
            ) : activeTab === 'games' ? (
              <>
                {paginatedGames.length > 0 ? (
                  <>
                    {/* --- MOBILE CARDS VIEW (< sm) --- */}
                    <div className="space-y-2.5 sm:hidden p-3 bg-background/50 flex-1 overflow-y-auto">
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
                    <div className="hidden sm:block overflow-x-auto table-scroll flex-1">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                            <TableHead className="w-8 bg-card sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]"></TableHead>
                            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider sticky left-8 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] min-w-[80px]">Spin ID</TableHead>
                            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[100px]">Game</TableHead>
                            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[120px]">Mode</TableHead>
                            <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[130px]">Date & Time</TableHead>
                            <TableHead className="text-center text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win Result</TableHead>
                            <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Bet</TableHead>
                            <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[80px]">Win</TableHead>
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
                                  <TableCell className="p-2 sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                                    <button
                                      onClick={() => toggleSpinExpand(spin.id)}
                                      className="p-1 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none transition-transform duration-200"
                                      style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                      aria-label={isExpanded ? "Collapse details" : "Expand details"}
                                    >
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    </button>
                                  </TableCell>
                                  <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5 sticky left-8 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">{spin.id}</TableCell>
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
                                </TableRow>

                                {isExpanded && (
                                  <TableRow className="border-border bg-secondary/10 hover:bg-secondary/10">
                                    <TableCell colSpan={8} className="p-3 sm:p-4">
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
                  </>
                ) : (
                  <div className="p-12 text-center text-muted-foreground text-xs font-medium">
                    No game plays found for the selected filter.
                  </div>
                )}

                {gamePlays.length > itemsPerPage && (
                  <ResponsivePagination 
                    currentPage={gamesPage}
                    totalPages={totalGamesPages}
                    onPageChange={setGamesPage}
                    totalItems={gamePlays.length}
                    itemsPerPage={itemsPerPage}
                  />
                )}
              </>
            ) : (
              <>
                <div className="overflow-x-auto table-scroll flex-1">
                  {paginatedPoints.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-muted-foreground text-xs uppercase tracking-wider sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] min-w-[120px]">Transaction ID</TableHead>
                          <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Date</TableHead>
                          <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[120px]">Type</TableHead>
                          <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedPoints.map((txn) => (
                          <TableRow key={txn.id} className="border-border hover:bg-secondary/30">
                            <TableCell className="font-semibold text-foreground text-xs sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">{txn.id}</TableCell>
                            <TableCell className="text-muted-foreground text-xs">{txn.date}</TableCell>
                            <TableCell>
                              <span className={`inline-flex items-center text-xs font-bold ${
                                txn.type === 'deposit' ? 'text-success-text' : 'text-danger-text'
                              }`}>
                                {txn.type === 'deposit' ? <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> : <ArrowDownRight className="mr-1 h-3.5 w-3.5" />}
                                {txn.type === 'deposit' ? 'Deposit' : 'Withdrawal'}
                              </span>
                            </TableCell>
                            <TableCell className={`text-right font-mono font-bold text-xs ${txn.type === 'deposit' ? 'text-success-text' : 'text-danger-text'}`}>
                              {txn.type === 'deposit' ? '+' : '-'}{formatCurrency(txn.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-12 text-center text-muted-foreground text-xs font-medium">
                      No transactions found for the selected filter.
                    </div>
                  )}
                </div>

                {pointsHistory.length > itemsPerPage && (
                  <ResponsivePagination 
                    currentPage={pointsPage}
                    totalPages={totalPointsPages}
                    onPageChange={setPointsPage}
                    totalItems={pointsHistory.length}
                    itemsPerPage={itemsPerPage}
                  />
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
