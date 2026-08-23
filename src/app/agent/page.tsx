"use client"

import * as React from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Coins, Users, ArrowUpRight, ArrowDownRight, RefreshCw, Send, Check, Loader2, Search, Filter, History } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { SUPERADMIN_DISPLAY_NAME } from '@/lib/ledger'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { ErrorBanner } from "@/components/error-banner"
import { transferPlayerCoinsAction } from './players/actions'
import { getAgentDashboardDataAction } from './actions'

export default function AgentDashboard() {
  const [players, setPlayers] = React.useState<Array<{ id: string; full_name: string; username: string; coin_balance: number }>>([])
  const [recentTransactions, setRecentTransactions] = React.useState<Array<{ id: string; direction: 'deposit' | 'withdraw'; amount: number; target_name: string; target_username: string; created_at: string }>>([])
  const [agentInfo, setAgentInfo] = React.useState<{ name: string; username: string; joinedDate: string } | null>(null)
  const [balance, setBalance] = React.useState(0)
  const [todaysBets, setTodaysBets] = React.useState(0)
  const [todaysWins, setTodaysWins] = React.useState(0)
  const [todaysProfitLoss, setTodaysProfitLoss] = React.useState(0)
  const [isLoadingDashboard, setIsLoadingDashboard] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  // Quick Transfer widget state
  const [selectedPlayerId, setSelectedPlayerId] = React.useState('')
  const [quickAmount, setQuickAmount] = React.useState('')
  const [isQuickTransferring, setIsQuickTransferring] = React.useState(false)
  const [quickTransferError, setQuickTransferError] = React.useState<string | null>(null)
  const [quickTransferSuccess, setQuickTransferSuccess] = React.useState<string | null>(null)

  // Recent Activity Filters & Pagination state
  const [searchQuery, setSearchQuery] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<'all' | 'deposit' | 'withdraw'>('all')
  const [currentPage, setCurrentPage] = React.useState(1)
  const itemsPerPage = 5

  const [countdown, setCountdown] = React.useState(60)
  // Issue #15: page-load error surfaced to the user instead of silently
  // leaving balance/KPIs/players stale on a backend failure.
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const fetchDashboardData = React.useCallback(() => {
    getAgentDashboardDataAction().then((resDash) => {
      setIsLoadingDashboard(false)
      setLoadError(resDash.error)
      if (!resDash.error) {
        setBalance(resDash.coin_balance || 0)
        setTodaysBets(resDash.todays_stake || 0)
        setTodaysWins(resDash.todays_payout || 0)
        setTodaysProfitLoss(resDash.todays_profit || 0)
        if (resDash.full_name) {
          setAgentInfo({
            name: resDash.full_name,
            username: resDash.username || 'agent',
            joinedDate: resDash.joined_date || 'Jul 28, 2026'
          })
        }
        if (resDash.recent_transfers) {
          setRecentTransactions(resDash.recent_transfers)
        }
        if (resDash.players) {
          setPlayers(resDash.players)
        }
      }
    }).catch((e) => {
      setIsLoadingDashboard(false)
      setLoadError(e instanceof Error ? e.message : 'Could not load dashboard data.')
    })
  }, [])

  React.useEffect(() => {
    fetchDashboardData() // initial: isLoadingDashboard already starts true

    const countdownTick = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? 60 : prev - 1))
    }, 1000)

    const dataInterval = setInterval(() => {
      setCountdown(60)
      fetchDashboardData() // silent: isLoadingDashboard already false by now
    }, 60000)

    return () => {
      clearInterval(countdownTick)
      clearInterval(dataInterval)
    }
  }, [fetchDashboardData])

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    setCountdown(60)
    fetchDashboardData() // manual: no skeleton, just spinner on button
    setTimeout(() => setIsRefreshing(false), 600)
  }

  const handleQuickTransfer = async (type: 'deposit' | 'withdraw') => {
    if (!selectedPlayerId) {
      setQuickTransferError('Please select a player from the list.')
      return
    }
    const amountNum = parseFloat(quickAmount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setQuickTransferError('Please enter a valid positive coin amount.')
      return
    }

    setIsQuickTransferring(true)
    setQuickTransferError(null)
    setQuickTransferSuccess(null)

    const res = await transferPlayerCoinsAction(selectedPlayerId, amountNum, type === 'deposit' ? 'credit' : 'debit')

    setIsQuickTransferring(false)
    if (res.error) {
      setQuickTransferError(res.error)
    } else {
      const selectedP = players.find(p => p.id === selectedPlayerId)
      setQuickTransferSuccess(`Successfully ${type === 'deposit' ? 'deposited' : 'withdrawn'} ${formatCurrency(amountNum)} Coins for @${selectedP?.username || 'player'}!`)
      setQuickAmount('')
      if (res.agent_coin_balance !== undefined) {
        setBalance(res.agent_coin_balance)
      }
      fetchDashboardData()
      setTimeout(() => setQuickTransferSuccess(null), 3500)
    }
  }

  const handleAddPresetAmount = (addVal: number) => {
    const currentNum = parseFloat(quickAmount) || 0
    setQuickAmount((currentNum + addVal).toString())
    setQuickTransferError(null)
  }

  const filteredTransactions = recentTransactions.filter(txn => {
    const matchesSearch = !searchQuery || txn.target_name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = typeFilter === 'all' || txn.direction === typeFilter
    return matchesSearch && matchesType
  })

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage) || 1
  const paginatedTransactions = filteredTransactions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      <ErrorBanner error={loadError} />
      {/* Top Page Header Bar (Agent Profile Badge) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-card border border-border/80 rounded-2xl shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <Coins className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground">
                {agentInfo?.name || 'Agent Cashier'}
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-primary/10 text-primary border border-primary/20 uppercase tracking-wider">
                Agent Back-Office
              </span>
            </div>
            <p className="text-muted-foreground text-xs leading-tight font-mono mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-bold text-foreground/80">@{agentInfo?.username || 'agent'}</span>
              <span>&bull;</span>
              <span className="text-muted-foreground">Joined: {agentInfo?.joinedDate || 'Jul 28, 2026'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Auto-Sync ({countdown}s)
          </span>
          <Button onClick={handleManualRefresh} variant="outline" size="sm" className="w-full sm:w-auto h-8 sm:h-9 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Top KPI Metric Cards (5 Micro Cards Grid - Mobile First) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-3">
        {/* Card 1: Available Coins */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>Available Coins</span>
            <Coins className="h-3.5 w-3.5 text-emerald-500 shrink-0 hidden sm:block" />
          </div>
          <div className={`text-xs sm:text-lg font-black font-mono text-emerald-500 mt-0.5 truncate transition-opacity duration-200 ${isLoadingDashboard ? 'opacity-50 animate-pulse' : 'opacity-100'}`}>
            {formatCurrency(balance)}
          </div>
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">Coins available to allocate</p>
        </Card>

        {/* Card 2: My Players */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>My Players</span>
            <Users className="h-3.5 w-3.5 text-blue-500 shrink-0 hidden sm:block" />
          </div>
          <div className={`text-xs sm:text-lg font-black font-mono text-foreground mt-0.5 transition-opacity duration-200 ${isLoadingDashboard ? 'opacity-50 animate-pulse' : 'opacity-100'}`}>
            {players.length}
          </div>
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">Registered player network</p>
        </Card>

        {/* Card 3: Today's P/L */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>Today&apos;s P/L</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500 shrink-0 hidden sm:block" />
          </div>
          <div className={`text-xs sm:text-lg font-black font-mono mt-0.5 truncate transition-opacity duration-200 ${isLoadingDashboard ? 'opacity-50 animate-pulse' : 'opacity-100'} ${todaysProfitLoss >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {todaysProfitLoss >= 0 ? '+' : ''}{formatCurrency(todaysProfitLoss)}
          </div>
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">Resets daily 00:00 IST</p>
        </Card>

        {/* Card 4: Today's Bets (In) */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>Today Bets (In)</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-blue-400 shrink-0 hidden sm:block" />
          </div>
          <div className={`text-xs sm:text-lg font-black font-mono text-foreground mt-0.5 truncate transition-opacity duration-200 ${isLoadingDashboard ? 'opacity-50 animate-pulse' : 'opacity-100'}`}>
            {formatCurrency(todaysBets)}
          </div>
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">Wagered coins today</p>
        </Card>

        {/* Card 5: Today's Wins (Out) */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>Today Wins (Out)</span>
            <ArrowDownRight className="h-3.5 w-3.5 text-amber-500 shrink-0 hidden sm:block" />
          </div>
          <div className={`text-xs sm:text-lg font-black font-mono text-amber-500 mt-0.5 truncate transition-opacity duration-200 ${isLoadingDashboard ? 'opacity-50 animate-pulse' : 'opacity-100'}`}>
            {formatCurrency(todaysWins)}
          </div>
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">Returned to players today</p>
        </Card>
      </div>

      {/* Main Grid: Quick Transfer & Recent Activity Feed */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Quick Coin Transfer Widget */}
        <Card className="bg-card border-border/80 p-3 sm:p-4 rounded-xl shadow-xs space-y-3">
          <div className="flex items-center space-x-2 border-b border-border/50 pb-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Send className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-extrabold text-sm sm:text-base text-foreground leading-tight">Quick Coin Transfer</h2>
              <p className="text-muted-foreground text-[11px] leading-none mt-0.5">Instantly deposit or withdraw coins for any player.</p>
            </div>
          </div>

          {quickTransferError && (
            <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20 flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-2 shrink-0 animate-ping" />
              {quickTransferError}
            </div>
          )}
          {quickTransferSuccess && (
            <div className="p-2.5 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20 flex items-center space-x-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{quickTransferSuccess}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="player-select" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Select Target Player
            </Label>
            <select 
              id="player-select"
              value={selectedPlayerId}
              onChange={(e) => {
                setSelectedPlayerId(e.target.value)
                setQuickTransferError(null)
              }}
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-foreground text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">-- Choose a Player --</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>
                  {p.full_name} (@{p.username}) — {formatCurrency(p.coin_balance)} Coins
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="quick-amount" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Amount (Coins)
              </Label>
              {quickAmount && (
                <button
                  type="button"
                  onClick={() => setQuickAmount('')}
                  className="text-[11px] text-muted-foreground hover:text-foreground font-bold cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
            <Input 
              id="quick-amount"
              type="number"
              step="1"
              min="1"
              placeholder="e.g. 1000"
              value={quickAmount}
              onChange={(e) => {
                setQuickAmount(e.target.value)
                setQuickTransferError(null)
              }}
              className="h-9 bg-background border-border text-foreground font-mono text-xs rounded-lg"
            />

            {/* Quick Presets Pills */}
            <div className="flex items-center space-x-1.5 pt-1">
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Quick:</span>
              {[100, 500, 1000, 5000].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleAddPresetAmount(val)}
                  className="px-2 py-0.5 rounded bg-secondary/60 hover:bg-secondary text-foreground text-[10px] font-mono font-bold transition-all cursor-pointer border border-border/40"
                >
                  +{val}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-2">
            <Button 
              onClick={() => handleQuickTransfer('deposit')}
              disabled={isQuickTransferring}
              className="h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-lg shadow-sm cursor-pointer"
            >
              {isQuickTransferring ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="mr-1 h-3.5 w-3.5 stroke-[3]" />}
              Quick Deposit
            </Button>
            <Button 
              onClick={() => handleQuickTransfer('withdraw')}
              disabled={isQuickTransferring}
              variant="destructive" 
              className="h-10 font-extrabold text-xs rounded-lg shadow-sm cursor-pointer"
            >
              {isQuickTransferring ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowDownRight className="mr-1 h-3.5 w-3.5 stroke-[3]" />}
              Quick Withdraw
            </Button>
          </div>
        </Card>

        {/* Recent Activity Snapshot Widget */}
        <Card className="bg-card border-border/80 p-3 sm:p-4 rounded-xl shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-info/10 text-info">
                <History className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-extrabold text-sm sm:text-base text-foreground leading-tight">Recent Coin Transfers</h2>
                <p className="text-muted-foreground text-[11px] leading-none mt-0.5">Your latest cashier transfers.</p>
              </div>
            </div>

            <Link href="/agent/history" className="text-xs font-bold text-primary hover:underline flex items-center space-x-1">
              <span>View All</span>
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          {/* Search & Filter Bar for Transfers */}
          <div className="flex items-center justify-between gap-2 bg-background p-1.5 border border-border/80 rounded-lg">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground/70" />
              <Input
                placeholder="Search @player..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
                className="pl-7 h-7 bg-transparent border-none text-foreground text-xs focus-visible:ring-0"
              />
            </div>

            <div className="flex items-center space-x-1">
              <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value as 'all' | 'deposit' | 'withdraw')
                  setCurrentPage(1)
                }}
                className="h-7 px-1.5 rounded bg-card border border-border/60 text-foreground text-[11px] font-semibold focus:outline-none cursor-pointer"
              >
                <option value="all">All</option>
                <option value="deposit">Deposits</option>
                <option value="withdraw">Withdrawals</option>
              </select>
            </div>
          </div>

          {/* Desktop Table Feed (≥ 640px) */}
          <div className="hidden sm:block rounded-lg border border-border/80 bg-background overflow-hidden">
            {isLoadingDashboard ? (
              <Table>
                <TableBody>
                  {[1, 2, 3, 4].map((i) => (
                    <TableRow key={i} className="border-border">
                      <TableCell className="py-2"><div className="h-3.5 bg-secondary/80 rounded animate-pulse w-20" /></TableCell>
                      <TableCell className="py-2"><div className="h-3.5 bg-secondary/60 rounded animate-pulse w-24" /></TableCell>
                      <TableCell className="text-right py-2"><div className="h-3.5 bg-secondary/70 rounded animate-pulse w-14 ml-auto" /></TableCell>
                      <TableCell className="text-right py-2"><div className="h-3.5 bg-secondary/60 rounded animate-pulse w-12 ml-auto" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : paginatedTransactions.length > 0 ? (
              <Table>
                <TableBody>
                  {paginatedTransactions.map((txn) => (
                    <TableRow key={txn.id} className="border-border hover:bg-secondary/30 transition-colors">
                      <TableCell className="py-2">
                        <div>
                          <div className="font-bold text-foreground text-xs">{txn.target_name}</div>
                          {txn.target_name !== SUPERADMIN_DISPLAY_NAME && txn.target_username && (
                            <div className="text-[10px] text-muted-foreground font-mono">{txn.target_username}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground font-mono py-2">
                        {txn.created_at}
                      </TableCell>
                      <TableCell className="text-right py-2">
                        {txn.direction === 'deposit' ? (
                          <span className="inline-flex items-center text-emerald-500 font-mono font-black text-xs">
                            +{formatCurrency(txn.amount)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-red-500 font-mono font-black text-xs">
                            -{formatCurrency(txn.amount)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs py-2">
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-500 px-2 py-0.5 text-[10px] font-extrabold border border-emerald-500/20">
                          <Check className="mr-0.5 h-3 w-3" /> Success
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground font-medium">
                No coin transfers recorded matching filter criteria.
              </div>
            )}
          </div>

          {/* Mobile Cards Feed (< 640px) */}
          <div className="sm:hidden space-y-2">
            {isLoadingDashboard ? (
              [1, 2, 3].map((i) => (
                <div key={i} className="p-2.5 rounded-lg border border-border/80 bg-background space-y-1.5 animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="h-3.5 bg-secondary/80 rounded w-20" />
                    <div className="h-3.5 bg-secondary/60 rounded w-14" />
                  </div>
                </div>
              ))
            ) : paginatedTransactions.length > 0 ? (
              paginatedTransactions.map((txn) => (
                <div key={txn.id} className="p-2.5 rounded-lg border border-border/80 bg-background flex items-center justify-between text-xs">
                  <div>
                    <span className="font-extrabold text-foreground text-xs block">
                      {txn.target_name === SUPERADMIN_DISPLAY_NAME ? SUPERADMIN_DISPLAY_NAME : `@${txn.target_name.replace(/^@+/, '')}`}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">{txn.created_at}</span>
                  </div>

                  <div className="text-right">
                    {txn.direction === 'deposit' ? (
                      <span className="text-emerald-500 font-mono font-black text-xs block">
                        +{formatCurrency(txn.amount)}
                      </span>
                    ) : (
                      <span className="text-red-500 font-mono font-black text-xs block">
                        -{formatCurrency(txn.amount)}
                      </span>
                    )}
                    <span className="inline-flex items-center text-emerald-500 text-[10px] font-bold">
                      <Check className="mr-0.5 h-2.5 w-2.5" /> Done
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground font-medium bg-background rounded-lg border border-border/80">
                No coin transfers recorded.
              </div>
            )}
          </div>

          {filteredTransactions.length > itemsPerPage && (
            <div className="pt-1">
              <ResponsivePagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                totalItems={filteredTransactions.length}
                itemsPerPage={itemsPerPage}
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
