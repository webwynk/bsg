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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ArrowLeft, Users, Wallet, Activity, CalendarIcon, ArrowUpRight, ArrowDownRight } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"

const MOCK_AGENT_INFO = {
  id: '1',
  name: 'Alpha Agency',
  username: 'agent_alpha',
  balance: 5000000,
  status: 'Active',
  totalPlayers: 12,
}

const MOCK_AGENT_PLAYERS = [
  { id: 'p1', name: 'Rahul S.', username: 'rahul99', balance: 1500000, status: 'Active', gamePlays: 142 },
  { id: 'p2', name: 'Vikram K.', username: 'vikram_k', balance: 50000, status: 'Active', gamePlays: 18 },
  { id: 'p3', name: 'Neha R.', username: 'neha_r', balance: 250000, status: 'Blocked', gamePlays: 89 },
  { id: 'p4', name: 'Amit P.', username: 'amit_p', balance: 0, status: 'Active', gamePlays: 0 },
]

// Mock databases of game play and point transfers
const MOCK_GAME_PLAYS = [
  { id: 'SPIN-101', player: 'rahul99', game: 'Wheel of Fortune', bet: 10000, win: 25000, date: '2026-07-01' },
  { id: 'SPIN-102', player: 'rahul99', game: 'Slot Rush', bet: 20000, win: 0, date: '2026-07-01' },
  { id: 'SPIN-103', player: 'rahul99', game: 'Double Ring', bet: 15000, win: 30000, date: '2026-06-30' },
  { id: 'SPIN-104', player: 'vikram_k', game: 'Slot Rush', bet: 5000, win: 0, date: '2026-07-01' },
  { id: 'SPIN-105', player: 'neha_r', game: 'Wheel of Fortune', bet: 50000, win: 150000, date: '2026-06-28' },
  { id: 'SPIN-106', player: 'rahul99', game: 'Double Ring', bet: 10000, win: 0, date: '2026-06-25' },
  { id: 'SPIN-107', player: 'rahul99', game: 'Slot Rush', bet: 30000, win: 60000, date: '2026-06-25' },
]

const MOCK_POINTS_HISTORY = [
  { id: 'TXN-501', player: 'rahul99', type: 'deposit', amount: 500000, date: '2026-07-01' },
  { id: 'TXN-502', player: 'rahul99', type: 'withdraw', amount: 100000, date: '2026-06-30' },
  { id: 'TXN-503', player: 'vikram_k', type: 'deposit', amount: 50000, date: '2026-07-01' },
  { id: 'TXN-504', player: 'neha_r', type: 'deposit', amount: 250000, date: '2026-06-28' },
  { id: 'TXN-505', player: 'rahul99', type: 'deposit', amount: 150000, date: '2026-06-25' },
]

interface Props {
  params: React.Usable<{ agentId: string }>
}

export default function AgentDetailPage({ params }: Props) {
  const { agentId } = React.use(params)
  
  // Selected player state
  const [selectedPlayer, setSelectedPlayer] = React.useState(MOCK_AGENT_PLAYERS[0])
  const [activeTab, setActiveTab] = React.useState<'games' | 'points'>('games')
  
  // Calendar date filter state (default is undefined -> show all history)
  const [filterDate, setFilterDate] = React.useState<Date | undefined>(undefined)

  // Sub-table pagination states
  const [gamesPage, setGamesPage] = React.useState(1)
  const [pointsPage, setPointsPage] = React.useState(1)
  const itemsPerPage = 4

  // Reset pagination when player or date changes
  React.useEffect(() => {
    setGamesPage(1)
    setPointsPage(1)
  }, [selectedPlayer, filterDate])

  // Filter lists based on selected player & date filter
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

  // Sliced logs for pagination
  const totalGamesPages = Math.ceil(filteredGamePlays.length / itemsPerPage)
  const paginatedGames = filteredGamePlays.slice((gamesPage - 1) * itemsPerPage, gamesPage * itemsPerPage)

  const totalPointsPages = Math.ceil(filteredPointsHistory.length / itemsPerPage)
  const paginatedPoints = filteredPointsHistory.slice((pointsPage - 1) * itemsPerPage, pointsPage * itemsPerPage)

  const handleClearFilter = () => {
    setFilterDate(undefined)
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <a href="/superadmin/agents" className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
          <ArrowLeft className="h-4 w-4" />
        </a>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{MOCK_AGENT_INFO.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Agent ID: {agentId} &bull; Username: @{MOCK_AGENT_INFO.username}
          </p>
        </div>
      </div>

      {/* Stats Bento Grid */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Points Balance</span>
            <Wallet className="h-5 w-5 text-emerald-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-2xl font-bold font-mono tracking-tight">{formatCurrency(MOCK_AGENT_INFO.balance)}</div>
            <p className="text-xs text-muted-foreground mt-2">Available for player allocation</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active Players</span>
            <Users className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-2xl font-bold font-mono tracking-tight">{MOCK_AGENT_INFO.totalPlayers}</div>
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
              MOCK_AGENT_INFO.status === 'Active' ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'
            }`}>
              {MOCK_AGENT_INFO.status}
            </span>
            <p className="text-xs text-muted-foreground mt-2">Operational state</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Layout: Bento Grids (Left: Players, Right: Detailed User History) */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-12">
        {/* Left Bento: Agent's Players List (Col-span 5 on Desktop) */}
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
                {MOCK_AGENT_PLAYERS.length} total
              </span>
            </div>
            <div className="mt-3">
              <input
                type="text"
                placeholder="Search players..."
                className="w-full h-8 px-3 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto flex-1">
            <div className="divide-y divide-border/60">
              {MOCK_AGENT_PLAYERS.map((player) => (
                <div
                  key={player.id}
                  onClick={() => setSelectedPlayer(player)}
                  className={`p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-secondary/40 transition-all duration-150 ${
                    selectedPlayer.id === player.id ? 'bg-secondary/80 border-l-4 border-primary' : ''
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
                    <p className="font-bold text-sm font-mono tracking-tight">{formatCurrency(player.balance)}</p>
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                      {player.gamePlays} plays
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Right Bento: Selected Player Detailed History (Col-span 7 on Desktop) */}
        <Card className="lg:col-span-7 bg-card border-border shadow-sm rounded-xl overflow-hidden flex flex-col h-[580px]">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full border border-primary/20 bg-secondary/50 flex items-center justify-center font-bold text-primary tracking-wider text-sm shadow-sm shrink-0">
                  {selectedPlayer.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-lg font-bold text-foreground truncate">
                    History of {selectedPlayer.name}
                  </CardTitle>
                  <CardDescription className="text-muted-foreground text-xs truncate">
                    @{selectedPlayer.username} &bull; Balance: <span className="font-bold text-foreground font-mono">{formatCurrency(selectedPlayer.balance)}</span>
                  </CardDescription>
                </div>
              </div>
              
              {/* Calendar Filter widget */}
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
                      onSelect={setFilterDate}
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

          {/* Navigation tabs styled as a premium segment control */}
          <div className="px-4 py-2 border-b border-border/60 bg-secondary/20 flex space-x-2">
            <button
              onClick={() => setActiveTab('games')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'games' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Game Plays ({filteredGamePlays.length})
            </button>
            <button
              onClick={() => setActiveTab('points')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'points' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Points History ({filteredPointsHistory.length})
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
