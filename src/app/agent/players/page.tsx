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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Loader2, ArrowUpRight, ArrowDownRight, UserX, UserCheck, KeyRound, ArrowLeft } from "lucide-react"
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
  }>>([])
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

  const loadPlayers = React.useCallback((currentSelectedId?: string) => {
    getPlayersAction().then((res) => {
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
    })
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
      setSuccessMessage(`Player "@${username}" created successfully!`)
      loadPlayers()
      setTimeout(() => {
        setIsOpen(false)
        setSuccessMessage(null)
      }, 1200)
    }
  }

  const handleToggleStatus = async () => {
    if (!selectedPlayer) return
    setIsTogglingStatus(true)
    const res = await togglePlayerStatusAction(selectedPlayer.id, selectedPlayer.status)
    setIsTogglingStatus(false)
    if (res.success && res.newStatus) {
      setSelectedPlayer({ ...selectedPlayer, status: res.newStatus })
      loadPlayers(selectedPlayer.id)
    }
  }

  const handleTransferPoints = async (type: 'deposit' | 'withdraw') => {
    if (!selectedPlayer) return
    const amountNum = parseFloat(transferAmount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setTransferError('Please enter a valid positive amount.')
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
      if (res.newBalance !== undefined) {
        setSelectedPlayer({ ...selectedPlayer, balance: res.newBalance })
      }
      loadPlayers(selectedPlayer.id)
    }
  }

  const handleResetPassword = async () => {
    if (!selectedPlayer) return
    if (newPassword !== confirmPassword) {
      setResetPasswordError('Passwords do not match.')
      return
    }
    if (newPassword.trim().length < 6) {
      setResetPasswordError('Password must be at least 6 characters.')
      return
    }

    setIsResettingPassword(true)
    setResetPasswordError(null)
    setResetPasswordSuccess(null)

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

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Player Management</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Register players, block/unblock accounts, and transfer coins.
          </p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger className={buttonVariants({ variant: "default" })}>
            <Plus className="mr-2 h-4 w-4" /> Create Player
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-card border-border text-foreground">
            <DialogHeader>
              <DialogTitle>Register New Player</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Enter details to provision a new player account.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreatePlayer}>
              <div className="grid gap-4 py-4">
                {errorMessage && (
                  <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                    {errorMessage}
                  </div>
                )}
                {successMessage && (
                  <div className="p-3 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20">
                    {successMessage}
                  </div>
                )}

                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right text-muted-foreground">Name</Label>
                  <Input id="name" name="name" placeholder="Rahul S." className="col-span-3 bg-background border-border text-foreground" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="username" className="text-right text-muted-foreground">Username</Label>
                  <Input id="username" name="username" placeholder="rahul99" className="col-span-3 bg-background border-border text-foreground" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="password" className="text-right text-muted-foreground">Password</Label>
                  <Input id="password" name="password" type="password" className="col-span-3 bg-background border-border text-foreground" required />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isLoading} className="w-full font-bold cursor-pointer">
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isLoading ? 'Creating Player...' : 'Create Player'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-12">
        {/* Left Bento: Players Directory List */}
        <Card className={`lg:col-span-5 bg-card border-border shadow-sm rounded-xl overflow-hidden flex flex-col h-[600px] transition-all duration-300 ${
          showMobileDetail ? 'hidden lg:flex' : 'flex'
        }`}>
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-lg font-bold text-foreground">Registered Players ({players.length})</CardTitle>
            <CardDescription className="text-muted-foreground">
              Click a player to view details or perform coin operations.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto flex-1">
            {players.length > 0 ? (
              <div className="divide-y divide-border/60">
                {players.map((player) => (
                  <div
                    key={player.id}
                    onClick={() => handleSelectPlayer(player)}
                    className={`p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-secondary/40 transition-colors ${
                      selectedPlayer?.id === player.id ? 'bg-secondary/80 border-l-4 border-primary' : ''
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="font-bold text-sm text-foreground truncate">{player.name}</p>
                        <span className={`inline-block w-2 h-2 rounded-full ${player.status === 'Active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      </div>
                      <span className="text-xs text-muted-foreground">@{player.username}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm font-mono">{formatCurrency(player.balance)} Coins</p>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${player.status === 'Active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                        {player.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground text-xs font-medium">
                No players created yet. Click &quot;Create Player&quot; to provision a game account.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Bento: Selected Player Details */}
        <Card className={`lg:col-span-7 bg-card border-border shadow-sm rounded-xl overflow-hidden flex flex-col h-[600px] transition-all duration-300 ${
          showMobileDetail ? 'flex' : 'hidden lg:flex'
        }`}>
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col gap-4">
              {/* Mobile Back Button */}
              <div className="lg:hidden flex items-center">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowMobileDetail(false)}
                  className="px-0 hover:bg-transparent text-primary hover:text-primary/80 font-bold"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to Directory
                </Button>
              </div>

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <CardTitle className="text-lg font-bold text-foreground">
                    {selectedPlayer ? `Player: ${selectedPlayer.name}` : 'Player Details'}
                  </CardTitle>
                  <CardDescription className="text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    {selectedPlayer ? `@${selectedPlayer.username} • Coins: ${formatCurrency(selectedPlayer.balance)}` : 'Select a player from the directory'}
                  </CardDescription>
                </div>

                {selectedPlayer && (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Deposit Modal */}
                    <Dialog 
                      open={activeTransferModal === 'deposit'}
                      onOpenChange={(open) => {
                        setActiveTransferModal(open ? 'deposit' : null)
                        setTransferAmount('')
                        setTransferError(null)
                      }}
                    >
                      <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer text-xs font-bold" })}>
                        <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> Deposit
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
                        <DialogHeader>
                          <DialogTitle>Deposit Coins</DialogTitle>
                          <DialogDescription className="text-muted-foreground">
                            Add coins to {selectedPlayer.name}&apos;s account.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                          {transferError && (
                            <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                              {transferError}
                            </div>
                          )}
                          <div className="space-y-2">
                            <Label htmlFor="player-deposit-amount">Amount (Coins)</Label>
                            <Input 
                              id="player-deposit-amount" 
                              type="number" 
                              placeholder="1000" 
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
                      <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer text-xs font-bold" })}>
                        <ArrowDownRight className="mr-1 h-3.5 w-3.5" /> Withdraw
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
                        <DialogHeader>
                          <DialogTitle>Withdraw Coins</DialogTitle>
                          <DialogDescription className="text-muted-foreground">
                            Recall coins from {selectedPlayer.name}&apos;s account.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                          {transferError && (
                            <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                              {transferError}
                            </div>
                          )}
                          <div className="space-y-2">
                            <Label htmlFor="player-withdraw-amount">Amount (Coins)</Label>
                            <Input 
                              id="player-withdraw-amount" 
                              type="number" 
                              placeholder="1000" 
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

                    {/* Reset Password Modal */}
                    <Dialog 
                      open={isPasswordResetOpen}
                      onOpenChange={(open) => {
                        setIsPasswordResetOpen(open)
                        setNewPassword('')
                        setConfirmPassword('')
                        setResetPasswordError(null)
                        setResetPasswordSuccess(null)
                      }}
                    >
                      <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "border-primary/30 text-primary hover:bg-primary/10 cursor-pointer text-xs font-bold" })}>
                        <KeyRound className="mr-1 h-3.5 w-3.5" /> Password
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
                        <DialogHeader>
                          <DialogTitle>Reset Player Password</DialogTitle>
                          <DialogDescription className="text-muted-foreground">
                            Enter a new password for {selectedPlayer.name}.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
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
                          <div className="space-y-2">
                            <Label htmlFor="new-password">New Password</Label>
                            <Input 
                              id="new-password" 
                              type="password" 
                              placeholder="At least 6 characters" 
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="bg-background border-border text-foreground" 
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="confirm-password">Confirm Password</Label>
                            <Input 
                              id="confirm-password" 
                              type="password" 
                              placeholder="Confirm new password" 
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              className="bg-background border-border text-foreground" 
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button 
                            onClick={handleResetPassword} 
                            disabled={isResettingPassword}
                            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold cursor-pointer"
                          >
                            {isResettingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {isResettingPassword ? 'Updating Password...' : 'Update Password'}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    {/* Block / Unblock Button */}
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleToggleStatus}
                      disabled={isTogglingStatus}
                      className={`text-xs cursor-pointer ${
                        selectedPlayer.status === 'Active' 
                          ? 'border-red-500/30 text-red-500 hover:bg-red-500/10' 
                          : 'border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10'
                      }`}
                    >
                      {isTogglingStatus ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : (
                        selectedPlayer.status === 'Active' ? <UserX className="mr-1 h-3.5 w-3.5" /> : <UserCheck className="mr-1 h-3.5 w-3.5" />
                      )}
                      {selectedPlayer.status === 'Active' ? 'Block' : 'Unblock'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>

          {/* Navigation Tabs */}
          <div className="flex border-b border-border/60 bg-secondary/30">
            <button
              onClick={() => setActiveTab('games')}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all flex items-center justify-center space-x-1.5 ${
                activeTab === 'games' ? 'border-primary text-foreground bg-secondary/50' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>Game Plays</span>
              {isLoadingHistory ? (
                <span className="inline-block h-4 w-6 rounded bg-secondary/80 animate-pulse" />
              ) : (
                <span>({gamePlays.length})</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('points')}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all flex items-center justify-center space-x-1.5 ${
                activeTab === 'points' ? 'border-primary text-foreground bg-secondary/50' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>Coins History</span>
              {isLoadingHistory ? (
                <span className="inline-block h-4 w-6 rounded bg-secondary/80 animate-pulse" />
              ) : (
                <span>({pointsHistory.length})</span>
              )}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-card text-foreground">
            {isLoadingHistory ? (
              <div className="p-6 space-y-4">
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
              gamePlays.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Spin ID</TableHead>
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[110px]">Game</TableHead>
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[160px]">Selections Bet</TableHead>
                      <TableHead className="text-center text-muted-foreground text-xs uppercase tracking-wider min-w-[90px]">Win Result</TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[90px]">Bet</TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[90px]">Win</TableHead>
                      <TableHead className="text-center text-muted-foreground text-xs uppercase tracking-wider min-w-[80px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gamePlays.map((spin) => (
                      <TableRow key={spin.id} className="border-border hover:bg-secondary/30">
                        <TableCell className="font-mono text-xs font-bold text-foreground">{spin.id}</TableCell>
                        <TableCell className="text-xs font-semibold text-foreground">{spin.game}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-[200px]" title={spin.selections}>
                          {spin.selections}
                        </TableCell>
                        <TableCell className="text-center font-mono font-extrabold text-xs text-primary bg-primary/5 rounded">
                          {spin.resultNumber.toString().padStart(3, '0')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-foreground">
                          {formatCurrency(spin.bet)}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs font-bold ${spin.win > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                          {spin.win > 0 ? `+${formatCurrency(spin.win)}` : '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                            spin.status === 'WON' ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'
                          }`}>
                            {spin.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-12 text-center text-xs text-muted-foreground font-medium">
                  {selectedPlayer ? 'No game play history recorded yet for this player.' : 'Select a player to view game play history.'}
                </div>
              )
            ) : (
              pointsHistory.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[120px]">Transaction ID</TableHead>
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[140px]">Date & Time</TableHead>
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Type</TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Amount</TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[120px]">Balance After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pointsHistory.map((tx) => (
                      <TableRow key={tx.id} className="border-border hover:bg-secondary/30">
                        <TableCell className="font-mono text-xs font-bold text-foreground">{tx.id}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{tx.date}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center text-xs font-bold ${
                            tx.type === 'deposit' ? 'text-success-text' : 'text-danger-text'
                          }`}>
                            {tx.type === 'deposit' ? <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> : <ArrowDownRight className="mr-1 h-3.5 w-3.5" />}
                            {tx.type === 'deposit' ? 'Deposit (+)' : 'Withdrawal (-)'}
                          </span>
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs font-bold ${
                          tx.type === 'deposit' ? 'text-success-text' : 'text-danger-text'
                        }`}>
                          {tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}
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
                  {selectedPlayer ? 'No cashier transactions recorded yet for this player.' : 'Select a player to view cashier history.'}
                </div>
              )
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
