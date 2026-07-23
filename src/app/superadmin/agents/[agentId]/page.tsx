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
import { ArrowLeft, Users, Coins, Activity, CalendarIcon, ArrowUpRight, ArrowDownRight, Loader2, UserX, UserCheck, Key } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { getAgentDetailAction, transferPointsAction, toggleAgentStatusAction, updateAgentPasswordAction } from '../actions'

interface Props {
  params: React.Usable<{ agentId: string }>
}

export default function AgentDetailPage({ params }: Props) {
  const { agentId } = React.use(params)
  
  const [agentInfo, setAgentInfo] = React.useState<{ id: string; name: string; username: string; balance: number; status: string } | null>(null)
  const [players, setPlayers] = React.useState<Array<{ id: string; name: string; username: string; balance: number; status: string; gamePlays: number }>>([])
  const [selectedPlayer, setSelectedPlayer] = React.useState<typeof players[0] | null>(null)
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

  const [gamesPage, setGamesPage] = React.useState(1)
  const [pointsPage, setPointsPage] = React.useState(1)
  const itemsPerPage = 4

  const loadAgentDetails = React.useCallback(() => {
    getAgentDetailAction(agentId).then((res) => {
      if (res.agent) {
        setAgentInfo(res.agent)
      }
      if (res.players) {
        setPlayers(res.players)
        if (res.players.length > 0 && !selectedPlayer) {
          setSelectedPlayer(res.players[0])
        }
      }
    })
  }, [agentId, selectedPlayer])

  React.useEffect(() => {
    loadAgentDetails()
  }, [loadAgentDetails])

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

  const gamePlays: Array<{ id: string; player: string; game: string; bet: number; win: number; date: string }> = []
  const pointsHistory: Array<{ id: string; player: string; type: 'deposit' | 'withdraw'; amount: number; date: string }> = []

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
                    <Input 
                      id="new-password" 
                      type="password" 
                      placeholder="••••••••" 
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="bg-background border-border text-foreground"
                      required
                      minLength={6}
                    />
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
                      setSelectedPlayer(player)
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
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'games' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Game Plays (0)
            </button>
            <button
              onClick={() => setActiveTab('points')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'points' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Coins History (0)
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col justify-between">
            {activeTab === 'games' ? (
              <>
                <div className="overflow-x-auto table-scroll flex-1">
                  {paginatedGames.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-muted-foreground text-xs uppercase tracking-wider sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] min-w-[100px]">Spin ID</TableHead>
                          <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[120px]">Game</TableHead>
                          <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Date</TableHead>
                          <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Bet</TableHead>
                          <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">Win</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedGames.map((spin) => (
                          <TableRow key={spin.id} className="border-border hover:bg-secondary/30">
                            <TableCell className="font-semibold text-foreground text-xs sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">{spin.id}</TableCell>
                            <TableCell className="text-foreground text-xs font-medium">{spin.game}</TableCell>
                            <TableCell className="text-muted-foreground text-xs">{spin.date}</TableCell>
                            <TableCell className="text-right text-foreground font-mono text-xs font-medium">
                              {formatCurrency(spin.bet)}
                            </TableCell>
                            <TableCell className={`text-right font-mono font-bold text-xs ${spin.win > 0 ? 'text-success-text' : 'text-muted-foreground'}`}>
                              {spin.win > 0 ? `+${formatCurrency(spin.win)}` : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-12 text-center text-muted-foreground text-xs font-medium">
                      No game plays found for the selected filter.
                    </div>
                  )}
                </div>

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
