"use client"

import * as React from 'react'
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Plus, ArrowUpRight, ArrowDownRight, UserMinus, UserCheck, CalendarIcon } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"

const MOCK_PLAYERS = [
  { id: '1', name: 'Rahul S.', username: 'rahul99', balance: 1500000, status: 'Active', gamePlays: 142 },
  { id: '2', name: 'Vikram K.', username: 'vikram_k', balance: 50000, status: 'Active', gamePlays: 18 },
  { id: '3', name: 'Neha R.', username: 'neha_r', balance: 250000, status: 'Blocked', gamePlays: 89 },
  { id: '4', name: 'Amit P.', username: 'amit_p', balance: 0, status: 'Active', gamePlays: 0 },
]

// Mock databases of game play and point transfers
const MOCK_GAME_PLAYS = [
  { id: 'SPIN-101', player: 'rahul99', game: 'Wheel of Fortune', bet: 10000, win: 25000, date: '2026-07-01' },
  { id: 'SPIN-102', player: 'rahul99', game: 'Slot Rush', bet: 20000, win: 0, date: '2026-07-01' },
  { id: 'SPIN-103', player: 'rahul99', game: 'Double Ring', bet: 15000, win: 30000, date: '2026-06-30' },
  { id: 'SPIN-104', player: 'vikram_k', game: 'Slot Rush', bet: 5000, win: 0, date: '2026-07-01' },
  { id: 'SPIN-105', player: 'neha_r', game: 'Wheel of Fortune', bet: 50000, win: 150000, date: '2026-06-28' },
  { id: 'SPIN-106', player: 'rahul99', game: 'Double Ring', bet: 10000, win: 0, date: '2026-06-25' },
]

const MOCK_POINTS_HISTORY = [
  { id: 'TXN-501', player: 'rahul99', type: 'deposit', amount: 500000, date: '2026-07-01' },
  { id: 'TXN-502', player: 'rahul99', type: 'withdraw', amount: 100000, date: '2026-06-30' },
  { id: 'TXN-503', player: 'vikram_k', type: 'deposit', amount: 50000, date: '2026-07-01' },
  { id: 'TXN-504', player: 'neha_r', type: 'deposit', amount: 250000, date: '2026-06-28' },
]

export default function PlayersPage() {
  const [selectedPlayer, setSelectedPlayer] = React.useState(MOCK_PLAYERS[0])
  const [activeTab, setActiveTab] = React.useState<'games' | 'points'>('games')
  const [filterDate, setFilterDate] = React.useState<Date | undefined>(undefined)

  // Sub-table pagination states
  const [gamesPage, setGamesPage] = React.useState(1)
  const [pointsPage, setPointsPage] = React.useState(1)
  const itemsPerPage = 4

  // Reset pagination on player/date change
  React.useEffect(() => {
    setGamesPage(1)
    setPointsPage(1)
  }, [selectedPlayer, filterDate])

  const filteredGamePlays = MOCK_GAME_PLAYS.filter(play => {
    if (play.player !== selectedPlayer.username) return false
    if (filterDate) {
      const dateString = filterDate.toISOString().split('T')[0]
      return play.date === dateString
    }
    return true
  })

  const filteredPointsHistory = MOCK_POINTS_HISTORY.filter(txn => {
    if (txn.player !== selectedPlayer.username) return false
    if (filterDate) {
      const dateString = filterDate.toISOString().split('T')[0]
      return txn.date === dateString
    }
    return true
  })

  const totalGamesPages = Math.ceil(filteredGamePlays.length / itemsPerPage)
  const paginatedGames = filteredGamePlays.slice((gamesPage - 1) * itemsPerPage, gamesPage * itemsPerPage)

  const totalPointsPages = Math.ceil(filteredPointsHistory.length / itemsPerPage)
  const paginatedPoints = filteredPointsHistory.slice((pointsPage - 1) * itemsPerPage, pointsPage * itemsPerPage)

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Player Management</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Register players, block/unblock accounts, and transfer points.
          </p>
        </div>

        <Dialog>
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
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right text-muted-foreground">Name</Label>
                <Input id="name" placeholder="Rahul S." className="col-span-3 bg-background border-border text-foreground" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="username" className="text-right text-muted-foreground">Username</Label>
                <Input id="username" placeholder="rahul99" className="col-span-3 bg-background border-border text-foreground" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="password" className="text-right text-muted-foreground">Password</Label>
                <Input id="password" type="password" className="col-span-3 bg-background border-border text-foreground" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full">Create Player</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-12">
        {/* Left Bento: Players Directory List (Col-span 5 on Desktop) */}
        <Card className="lg:col-span-5 bg-card border-border shadow-sm rounded-xl overflow-hidden flex flex-col h-[580px]">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-lg font-bold text-foreground">Registered Players</CardTitle>
            <CardDescription className="text-muted-foreground">
              Click a player to view details or perform balance operations.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto flex-1">
            <div className="divide-y divide-border/60">
              {MOCK_PLAYERS.map((player) => (
                <div
                  key={player.id}
                  onClick={() => setSelectedPlayer(player)}
                  className={`p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-secondary/40 transition-colors ${
                    selectedPlayer.id === player.id ? 'bg-secondary/80 border-l-4 border-primary' : ''
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <p className="font-bold text-sm text-foreground truncate">{player.name}</p>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${player.status === 'Active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    </div>
                    <span className="text-xs text-muted-foreground">@{player.username}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-sm font-mono">{formatCurrency(player.balance)}</p>
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                      {player.gamePlays} plays
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Right Bento: Selected Player Details and Audits (Col-span 7 on Desktop) */}
        <Card className="lg:col-span-7 bg-card border-border shadow-sm rounded-xl overflow-hidden flex flex-col h-[580px]">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="text-lg font-bold text-foreground">
                  History of {selectedPlayer.name}
                </CardTitle>
                <CardDescription className="text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  @{selectedPlayer.username} &bull; Balance: <span className="font-bold text-foreground font-mono">{formatCurrency(selectedPlayer.balance)}</span>
                </CardDescription>
              </div>

              {/* Date Filter & Clear */}
              <div className="flex items-center space-x-2 shrink-0">
                <Popover>
                  <PopoverTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "w-[140px] justify-start text-left font-normal border-border bg-background cursor-pointer" })}>
                    <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                    {filterDate ? filterDate.toISOString().split('T')[0] : <span>Filter Date</span>}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-border bg-card">
                    <Calendar
                      mode="single"
                      selected={filterDate}
                      onSelect={setFilterDate}
                    />
                  </PopoverContent>
                </Popover>
                {filterDate && (
                  <Button variant="ghost" size="sm" onClick={() => setFilterDate(undefined)} className="text-xs text-muted-foreground">
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {/* Quick Actions (Deposit / Withdraw / Block) */}
            <div className="flex flex-wrap gap-2 pt-4">
              {/* Deposit Modal */}
              <Dialog>
                <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer" })}>
                  <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> Deposit Points
                </DialogTrigger>
                <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
                  <DialogHeader>
                    <DialogTitle>Deposit Points</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                      Transfer points from your balance to {selectedPlayer.username}.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Your Balance:</span>
                      <span className="font-bold text-success-text">{formatCurrency(12500000)}</span>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount (INR)</Label>
                      <Input id="amount" type="number" placeholder="5000" className="bg-background border-border text-foreground text-lg" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button className="w-full bg-success text-white hover:bg-success/90">Confirm Deposit</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Withdraw Modal */}
              <Dialog>
                <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer" })}>
                  <ArrowDownRight className="mr-1 h-3.5 w-3.5" /> Withdraw Points
                </DialogTrigger>
                <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
                  <DialogHeader>
                    <DialogTitle>Withdraw Points</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                      Recall points from {selectedPlayer.username}'s account.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Player Balance:</span>
                      <span className="font-bold text-danger-text">{formatCurrency(selectedPlayer.balance)}</span>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount (INR)</Label>
                      <Input id="amount" type="number" placeholder="5000" max={selectedPlayer.balance / 100} className="bg-background border-border text-foreground text-lg" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm Withdrawal</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Block/Unblock Action */}
              <Button variant="ghost" size="sm" className={selectedPlayer.status === 'Active' ? 'text-danger-text hover:bg-danger-bg' : 'text-success-text hover:bg-success-bg'}>
                {selectedPlayer.status === 'Active' ? (
                  <>
                    <UserMinus className="mr-1 h-3.5 w-3.5" /> Block Account
                  </>
                ) : (
                  <>
                    <UserCheck className="mr-1 h-3.5 w-3.5" /> Activate Account
                  </>
                )}
              </Button>
            </div>
          </CardHeader>

          {/* Navigation Tabs */}
          <div className="flex border-b border-border/60 bg-secondary/30">
            <button
              onClick={() => setActiveTab('games')}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all ${
                activeTab === 'games' ? 'border-primary text-foreground bg-secondary/50' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Game Plays ({filteredGamePlays.length})
            </button>
            <button
              onClick={() => setActiveTab('points')}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all ${
                activeTab === 'points' ? 'border-primary text-foreground bg-secondary/50' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Points History ({filteredPointsHistory.length})
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col justify-between bg-card text-foreground">
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

                {filteredGamePlays.length > itemsPerPage && (
                  <ResponsivePagination 
                    currentPage={gamesPage}
                    totalPages={totalGamesPages}
                    onPageChange={setGamesPage}
                    totalItems={filteredGamePlays.length}
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

                {filteredPointsHistory.length > itemsPerPage && (
                  <ResponsivePagination 
                    currentPage={pointsPage}
                    totalPages={totalPointsPages}
                    onPageChange={setPointsPage}
                    totalItems={filteredPointsHistory.length}
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
