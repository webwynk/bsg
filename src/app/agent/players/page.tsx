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
import { Card } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Loader2, ArrowUpRight, ArrowDownRight, UserX, UserCheck, KeyRound, ArrowLeft, Eye, EyeOff, ChevronRight, Search, Users, Gamepad2, Coins } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { createPlayerAction, getPlayersAction, togglePlayerStatusAction, getPlayerDetailHistoryAction, resetPlayerPasswordAction } from './actions'
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
  const [players, setPlayers] = React.useState<Array<{ id: string; name: string; username: string; balance: number; status: string; gamePlays: number }>>([])
  const [selectedPlayer, setSelectedPlayer] = React.useState<typeof players[0] | null>(null)
  const [activeTab, setActiveTab] = React.useState<'games' | 'points'>('games')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [isLoadingPlayers, setIsLoadingPlayers] = React.useState(true)

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
    getPlayerDetailHistoryAction(playerId).then((res) => {
      setIsLoadingHistory(false)
      if (res) {
        setGamePlays(res.gamePlays)
        setPointsHistory(res.pointsHistory)
      }
    }).catch(() => setIsLoadingHistory(false))
  }, [])

  const loadPlayers = React.useCallback((currentSelectedId?: string) => {
    setIsLoadingPlayers(true)
    getPlayersAction().then((res) => {
      setIsLoadingPlayers(false)
      if (res.players) {
        setPlayers(res.players)
        const targetId = currentSelectedId || selectedPlayer?.id
        if (targetId) {
          const updated = res.players.find(p => p.id === targetId)
          if (updated) {
            setSelectedPlayer(updated)
            loadPlayerHistory(updated.id)
          }
        } else if (res.players.length > 0) {
          setSelectedPlayer(res.players[0])
          loadPlayerHistory(res.players[0].id)
        }
      }
    }).catch(() => setIsLoadingPlayers(false))
  }, [selectedPlayer?.id, loadPlayerHistory])

  React.useEffect(() => {
    loadPlayers()
  }, [])

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
    loadPlayerHistory(player.id)
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
      loadPlayers()
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
      loadPlayers(selectedPlayer.id)
    }
  }

  const handleToggleStatus = async () => {
    if (!selectedPlayer) return
    const nextStatus = selectedPlayer.status === 'Active' ? 'Disabled' : 'Active'
    setIsTogglingStatus(true)

    const res = await togglePlayerStatusAction(selectedPlayer.id, nextStatus)

    setIsTogglingStatus(false)
    if (!res.error) {
      loadPlayers(selectedPlayer.id)
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
    <div className="space-y-4 max-w-7xl mx-auto px-4 md:px-0 pb-12">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Users className="h-5 w-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
              Player Accounts
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-primary/10 text-primary border border-primary/20">
              {players.length} Total
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
            Manage player balances, reset passwords, track gameplay history and cashier points.
          </p>
        </div>

        {/* Add Player Modal */}
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger className={buttonVariants({ variant: "default", size: "lg", className: "w-full sm:w-auto h-11 px-5 font-extrabold shadow-lg shadow-primary/20 cursor-pointer rounded-xl text-sm" })}>
            <Plus className="mr-2 h-4 w-4 stroke-[3]" /> Add New Player
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-card border-border/80 text-foreground shadow-2xl rounded-2xl p-6">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-xl font-black">Register New Player</DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs">
                Create a new player account for your agent sub-network.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreatePlayer} className="space-y-4 pt-2">
              {errorMessage && (
                <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20 flex items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-2 shrink-0 animate-ping" />
                  {errorMessage}
                </div>
              )}
              {successMessage && (
                <div className="p-3 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20">
                  {successMessage}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Player Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g. Rahul Sharma"
                  className="h-11 bg-background/60 border-border text-foreground text-sm rounded-lg"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Username
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-sm text-muted-foreground/70 font-mono">@</span>
                  <Input
                    id="username"
                    name="username"
                    placeholder="player_rahul"
                    className="pl-8 h-11 bg-background/60 border-border text-foreground text-sm rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showCreatePassword ? "text" : "password"}
                    placeholder="At least 6 characters"
                    className="h-11 bg-background/60 border-border text-foreground pr-10 text-sm rounded-lg"
                    required
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

              <DialogFooter className="pt-2">
                <Button type="submit" disabled={isLoading} className="w-full h-11 font-extrabold text-sm rounded-lg shadow-md shadow-primary/10 cursor-pointer">
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isLoading ? 'Registering Player...' : 'Create Player Account'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Grid Container */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[640px]">
        {/* --- LEFT SIDE: PLAYERS LIST --- */}
        <div className={`md:col-span-4 space-y-3 ${showMobileDetail ? 'hidden md:block' : 'block'}`}>
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground/70" />
            <Input 
              placeholder="Search players..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-11 bg-card border-border/80 text-foreground text-sm rounded-xl focus:border-primary/50 shadow-xs" 
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-3 text-xs text-muted-foreground hover:text-foreground font-bold"
              >
                Clear
              </button>
            )}
          </div>

          {/* Player Cards List Container */}
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {isLoadingPlayers ? (
              [1, 2, 3, 4, 5].map((i) => (
                <Card key={i} className="p-3.5 border-border/60 bg-card/60 animate-pulse space-y-2 rounded-xl">
                  <div className="flex justify-between items-center">
                    <div className="h-4 bg-secondary/80 rounded w-1/3" />
                    <div className="h-4 bg-secondary/60 rounded-full w-14" />
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="h-3 bg-secondary/60 rounded w-1/4" />
                    <div className="h-4 bg-secondary/80 rounded w-20" />
                  </div>
                </Card>
              ))
            ) : filteredPlayers.length > 0 ? (
              filteredPlayers.map((player) => {
                const isSelected = selectedPlayer?.id === player.id
                return (
                  <button
                    key={player.id}
                    onClick={() => handleSelectPlayer(player)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col space-y-1.5 ${
                      isSelected
                        ? 'bg-primary/10 border-primary shadow-sm text-foreground'
                        : 'bg-card border-border/70 hover:bg-secondary/40 text-foreground'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${
                          isSelected ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary border border-primary/20'
                        }`}>
                          {player.name[0]?.toUpperCase()}
                        </div>
                        <span className="font-extrabold text-sm truncate">{player.name}</span>
                      </div>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black shrink-0 ${
                        player.status === 'Active'
                          ? 'bg-success-bg text-success-text border border-emerald-500/20'
                          : 'bg-danger-bg text-danger-text border border-red-500/20'
                      }`}>
                        {player.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
                      <span className="text-muted-foreground font-mono truncate">@{player.username}</span>
                      <span className="font-mono font-black text-foreground">{formatCurrency(player.balance)}</span>
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="p-8 text-center text-xs text-muted-foreground font-medium bg-card rounded-xl border border-border">
                No players found.
              </div>
            )}
          </div>
        </div>

        {/* --- RIGHT SIDE: PLAYER DETAILS & HISTORY --- */}
        <div className={`md:col-span-8 space-y-4 ${showMobileDetail ? 'block' : 'hidden md:block'}`}>
          {selectedPlayer ? (
            <div className="space-y-4">
              {/* Selected Player Header Card */}
              <Card className="border-border/80 bg-card/95 backdrop-blur-xs p-4 sm:p-6 rounded-2xl shadow-lg relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Mobile Back Button & Player Info */}
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => setShowMobileDetail(false)}
                      className="md:hidden p-2 rounded-xl bg-secondary text-foreground hover:bg-secondary/80 focus:outline-none"
                      aria-label="Back to players list"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>

                    <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-lg shrink-0">
                      {selectedPlayer.name[0]?.toUpperCase()}
                    </div>

                    <div>
                      <div className="flex items-center space-x-2">
                        <h2 className="text-lg sm:text-xl font-black text-foreground">{selectedPlayer.name}</h2>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                          selectedPlayer.status === 'Active'
                            ? 'bg-success-bg text-success-text border border-emerald-500/20'
                            : 'bg-danger-bg text-danger-text border border-red-500/20'
                        }`}>
                          {selectedPlayer.status}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-muted-foreground">@{selectedPlayer.username}</p>
                    </div>
                  </div>

                  {/* Player Balance Card */}
                  <div className="bg-secondary/40 border border-border/60 p-3 rounded-xl flex items-center justify-between sm:justify-end sm:space-x-4 min-w-[200px]">
                    <div className="text-left sm:text-right">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                        Coins Balance
                      </span>
                      <span className="text-xl font-mono font-black text-foreground">
                        {formatCurrency(selectedPlayer.balance)}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <Coins className="h-5 w-5" />
                    </div>
                  </div>
                </div>

                {/* Quick Actions Button Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-4 border-t border-border/60 mt-4">
                  {/* Deposit Modal */}
                  <Dialog open={activeTransferModal === 'deposit'} onOpenChange={(open) => {
                    setActiveTransferModal(open ? 'deposit' : null)
                    setTransferAmount('')
                    setTransferError(null)
                  }}>
                    <DialogTrigger className={buttonVariants({ variant: "default", size: "sm", className: "w-full h-11 bg-emerald-600 hover:bg-emerald-600/90 text-white font-extrabold cursor-pointer rounded-xl text-xs" })}>
                      <ArrowUpRight className="mr-1.5 h-4 w-4" /> Deposit Coins
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground rounded-2xl">
                      <DialogHeader>
                        <DialogTitle className="font-black">Deposit Coins</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                          Issue cashier coins to {selectedPlayer.name} (@{selectedPlayer.username}).
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-3">
                        {transferError && (
                          <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                            {transferError}
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label htmlFor="deposit-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Amount (Coins)
                          </Label>
                          <Input 
                            id="deposit-amount" 
                            type="number" 
                            placeholder="e.g. 500" 
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            className="h-11 bg-background border-border text-foreground text-sm rounded-lg" 
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          onClick={() => handleTransferPoints('deposit')} 
                          disabled={isTransferring}
                          className="w-full h-11 bg-emerald-600 text-white font-extrabold cursor-pointer rounded-lg text-sm"
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
                    <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "w-full h-11 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 font-extrabold cursor-pointer rounded-xl text-xs" })}>
                      <ArrowDownRight className="mr-1.5 h-4 w-4" /> Withdraw
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground rounded-2xl">
                      <DialogHeader>
                        <DialogTitle className="font-black">Withdraw Coins</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                          Deduct cashier coins from {selectedPlayer.name} (@{selectedPlayer.username}).
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-3">
                        {transferError && (
                          <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                            {transferError}
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label htmlFor="withdraw-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Amount (Coins)
                          </Label>
                          <Input 
                            id="withdraw-amount" 
                            type="number" 
                            placeholder="e.g. 200" 
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            className="h-11 bg-background border-border text-foreground text-sm rounded-lg" 
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          onClick={() => handleTransferPoints('withdraw')} 
                          disabled={isTransferring}
                          className="w-full h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 font-extrabold cursor-pointer rounded-lg text-sm"
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
                    <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "w-full h-11 border-primary/40 text-primary hover:bg-primary/10 cursor-pointer text-xs font-extrabold rounded-xl" })}>
                      <KeyRound className="mr-1.5 h-4 w-4" /> Password
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground rounded-2xl">
                      <DialogHeader>
                        <DialogTitle className="font-black">Reset Player Password</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                          Set a new password for {selectedPlayer.name}.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleResetPassword} className="space-y-4 py-2">
                        {resetPasswordError && (
                          <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                            {resetPasswordError}
                          </div>
                        )}
                        {resetPasswordSuccess && (
                          <div className="p-3 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20">
                            {resetPasswordSuccess}
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label htmlFor="new-password">New Password</Label>
                          <div className="relative">
                            <Input 
                              id="new-password" 
                              type={showNewPassword ? "text" : "password"} 
                              placeholder="At least 6 characters" 
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="h-11 w-full bg-background border-border text-foreground pr-10 text-sm rounded-lg" 
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
                            >
                              {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="confirm-password">Confirm Password</Label>
                          <div className="relative">
                            <Input 
                              id="confirm-password" 
                              type={showConfirmPassword ? "text" : "password"} 
                              placeholder="Confirm new password" 
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              className="h-11 w-full bg-background border-border text-foreground pr-10 text-sm rounded-lg" 
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
                            >
                              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>

                        <DialogFooter className="pt-2">
                          <Button 
                            type="submit" 
                            disabled={isResettingPassword}
                            className="w-full h-11 font-extrabold cursor-pointer text-sm rounded-lg"
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
                    size="sm"
                    className={`w-full h-11 font-extrabold cursor-pointer rounded-xl text-xs ${
                      selectedPlayer.status === 'Active'
                        ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                        : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                    }`}
                  >
                    {isTogglingStatus ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : (
                      selectedPlayer.status === 'Active' ? <UserX className="mr-1.5 h-4 w-4" /> : <UserCheck className="mr-1.5 h-4 w-4" />
                    )}
                    {selectedPlayer.status === 'Active' ? 'Disable Player' : 'Activate Player'}
                  </Button>
                </div>
              </Card>

              {/* History Section Container */}
              <Card className="border-border/80 bg-card/95 rounded-2xl overflow-hidden shadow-lg">
                {/* Tab Controls */}
                <div className="flex border-b border-border/60 bg-secondary/20">
                  <button
                    onClick={() => setActiveTab('games')}
                    className={`flex-1 py-3 text-xs sm:text-sm font-extrabold transition-all flex items-center justify-center space-x-2 border-b-2 ${
                      activeTab === 'games' ? 'border-primary text-foreground bg-card' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Gamepad2 className="h-4 w-4 text-primary" />
                    <span>Game Plays</span>
                    {isLoadingHistory ? (
                      <span className="inline-block h-3.5 w-5 rounded bg-secondary/80 animate-pulse" />
                    ) : (
                      <span className="text-xs text-muted-foreground">({gamePlays.length})</span>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('points')}
                    className={`flex-1 py-3 text-xs sm:text-sm font-extrabold transition-all flex items-center justify-center space-x-2 border-b-2 ${
                      activeTab === 'points' ? 'border-primary text-foreground bg-card' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Coins className="h-4 w-4 text-amber-400" />
                    <span>Coins History</span>
                    {isLoadingHistory ? (
                      <span className="inline-block h-3.5 w-5 rounded bg-secondary/80 animate-pulse" />
                    ) : (
                      <span className="text-xs text-muted-foreground">({pointsHistory.length})</span>
                    )}
                  </button>
                </div>

                {/* Tab Content Display */}
                <div className="overflow-x-auto table-scroll">
                  {isLoadingHistory ? (
                    <div className="p-6 space-y-3">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-secondary/20 animate-pulse border border-border/40">
                          <div className="h-4 bg-secondary/80 rounded w-1/4" />
                          <div className="h-4 bg-secondary/60 rounded w-1/3" />
                          <div className="h-4 bg-secondary/70 rounded w-1/6" />
                          <div className="h-4 bg-secondary/80 rounded w-1/5" />
                        </div>
                      ))}
                    </div>
                  ) : activeTab === 'games' ? (
                    gamePlays.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                            <TableHead className="w-10"></TableHead>
                            <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[90px]">Spin ID</TableHead>
                            <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[110px]">Game</TableHead>
                            <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[130px]">Mode</TableHead>
                            <TableHead className="text-center text-muted-foreground text-xs uppercase tracking-wider min-w-[90px]">Win Result</TableHead>
                            <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[90px]">Bet</TableHead>
                            <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[90px]">Win</TableHead>
                            <TableHead className="text-center text-muted-foreground text-xs uppercase tracking-wider min-w-[80px]">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gamePlays.map((spin) => {
                            const isExpanded = !!expandedSpins[spin.id]
                            return (
                              <React.Fragment key={spin.id}>
                                <TableRow className="border-border hover:bg-secondary/30 transition-colors">
                                  <TableCell>
                                    <button
                                      onClick={() => toggleSpinExpand(spin.id)}
                                      className="p-1 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none transition-transform duration-200"
                                      style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                      aria-label={isExpanded ? "Collapse details" : "Expand details"}
                                    >
                                      <ChevronRight className="h-4 w-4" />
                                    </button>
                                  </TableCell>
                                  <TableCell className="font-mono text-xs font-bold text-foreground">{spin.id}</TableCell>
                                  <TableCell className="text-xs font-semibold text-foreground">{spin.game}</TableCell>
                                  <TableCell className="text-xs font-bold text-primary">{spin.mode}</TableCell>
                                  <TableCell className="text-center font-mono font-extrabold text-xs text-primary bg-primary/10 rounded-lg px-2 py-0.5">
                                    {spin.resultNumber.toString().padStart(3, '0')}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs font-bold text-foreground">
                                    {formatCurrency(spin.bet)}
                                  </TableCell>
                                  <TableCell className={`text-right font-mono text-xs font-bold ${spin.win > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                                    {spin.win > 0 ? `+${formatCurrency(spin.win)}` : '-'}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black ${
                                      spin.status === 'WON' ? 'bg-success-bg text-success-text border border-emerald-500/20' : 'bg-danger-bg text-danger-text border border-red-500/20'
                                    }`}>
                                      {spin.status}
                                    </span>
                                  </TableCell>
                                </TableRow>

                                {isExpanded && (
                                  <TableRow className="border-border bg-secondary/5 hover:bg-secondary/5">
                                    <TableCell colSpan={8} className="p-4">
                                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                        {/* Single Digit Picks (Black) */}
                                        <div className="p-3.5 rounded-xl bg-card border border-border/60">
                                          <h4 className="font-extrabold text-[10px] uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                                            <span className="w-2.5 h-2.5 rounded-full bg-zinc-950 border border-zinc-700 inline-block shrink-0" />
                                            Single Picks (Black)
                                          </h4>
                                          {Object.keys(spin.singleBets || {}).length > 0 ? (
                                            <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
                                              {Object.entries(spin.singleBets).map(([num, val]) => {
                                                const isWinning = spin.blackDigit !== null && num === spin.blackDigit.toString()
                                                return (
                                                  <div key={num} className={`flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                                                    isWinning ? 'bg-zinc-950 text-zinc-50 border border-zinc-700 font-extrabold shadow-sm' : 'text-muted-foreground/90'
                                                  }`}>
                                                    <span>Digit: <strong className="text-foreground">{num}</strong></span>
                                                    <span className="font-mono">{formatCurrency(val)} Coins</span>
                                                  </div>
                                                )
                                              })}
                                            </div>
                                          ) : (
                                            <p className="text-[10px] text-muted-foreground italic">No Single bets placed.</p>
                                          )}
                                        </div>

                                        {/* Double Digit Picks (Green) */}
                                        <div className="p-3.5 rounded-xl bg-card border border-border/60">
                                          <h4 className="font-extrabold text-[10px] uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shrink-0" />
                                            Double Picks (Green)
                                          </h4>
                                          {Object.keys(spin.doubleBets || {}).length > 0 ? (
                                            <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
                                              {Object.entries(spin.doubleBets).map(([num, val]) => {
                                                const targetDouble = (spin.greenDigit !== null && spin.blackDigit !== null) 
                                                  ? `${spin.greenDigit}${spin.blackDigit}` 
                                                  : null
                                                const isWinning = targetDouble !== null && num.padStart(2, '0') === targetDouble.padStart(2, '0')
                                                return (
                                                  <div key={num} className={`flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                                                    isWinning ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-extrabold shadow-sm' : 'text-muted-foreground/90'
                                                  }`}>
                                                    <span>Picks: <strong className="text-foreground">{num.padStart(2, '0')}</strong></span>
                                                    <span className="font-mono">{formatCurrency(val)} Coins</span>
                                                  </div>
                                                )
                                              })}
                                            </div>
                                          ) : (
                                            <p className="text-[10px] text-muted-foreground italic">No Double bets placed.</p>
                                          )}
                                        </div>

                                        {/* Triple Digit Picks (Red) */}
                                        <div className="p-3.5 rounded-xl bg-card border border-border/60">
                                          <h4 className="font-extrabold text-[10px] uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                                            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shrink-0" />
                                            Triple Picks (Red)
                                          </h4>
                                          {Object.keys(spin.tripleBets || {}).length > 0 ? (
                                            <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
                                              {Object.entries(spin.tripleBets).map(([num, val]) => {
                                                const targetTriple = (spin.redDigit !== null && spin.greenDigit !== null && spin.blackDigit !== null) 
                                                  ? `${spin.redDigit}${spin.greenDigit}${spin.blackDigit}` 
                                                  : null
                                                const isWinning = targetTriple !== null && num.padStart(3, '0') === targetTriple.padStart(3, '0')
                                                return (
                                                  <div key={num} className={`flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                                                    isWinning ? 'bg-red-500/20 text-red-400 border border-red-500/30 font-extrabold shadow-sm' : 'text-muted-foreground/90'
                                                  }`}>
                                                    <span>Picks: <strong className="text-foreground">{num.padStart(3, '0')}</strong></span>
                                                    <span className="font-mono">{formatCurrency(val)} Coins</span>
                                                  </div>
                                                )
                                              })}
                                            </div>
                                          ) : (
                                            <p className="text-[10px] text-muted-foreground italic">No Triple bets placed.</p>
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
                    ) : (
                      <div className="p-12 text-center text-xs text-muted-foreground font-medium">
                        No game play history recorded yet for this player.
                      </div>
                    )
                  ) : (
                    pointsHistory.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                            <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[120px]">Transaction ID</TableHead>
                            <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[140px]">Date & Time</TableHead>
                            <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Type</TableHead>
                            <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Amount</TableHead>
                            <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[120px]">Balance After</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pointsHistory.map((tx) => (
                            <TableRow key={tx.id} className="border-border hover:bg-secondary/30 transition-colors">
                              <TableCell className="font-mono text-xs font-bold text-foreground">{tx.id}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{tx.date}</TableCell>
                              <TableCell className="text-xs">
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                                  tx.type === 'deposit'
                                    ? 'bg-success-bg text-success-text border border-emerald-500/20'
                                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/20'
                                }`}>
                                  {tx.type}
                                </span>
                              </TableCell>
                              <TableCell className={`text-right font-mono text-xs font-extrabold ${
                                tx.type === 'deposit' ? 'text-success-text' : 'text-amber-400'
                              }`}>
                                {tx.type === 'deposit' ? `+${formatCurrency(tx.amount)}` : `-${formatCurrency(tx.amount)}`}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-bold text-foreground">
                                {formatCurrency(tx.balanceAfter)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="p-12 text-center text-xs text-muted-foreground font-medium">
                        No coin transactions recorded yet for this player.
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
