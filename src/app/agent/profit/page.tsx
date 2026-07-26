"use client"

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { TrendingUp, Coins, Calendar as CalendarIcon, RefreshCw, Search, X, Activity, ArrowUpRight, ArrowDownRight, Award, Percent } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { getAgentProfitReportAction } from './actions'

export default function AgentProfitPage() {
  const [summary, setSummary] = React.useState({
    todaysPnl: 0,
    lifetimePnl: 0,
    totalVolume: 0,
    totalPayouts: 0,
    netMarginPct: 0
  })
  const [players, setPlayers] = React.useState<Array<{
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

  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  // Filters & Pagination State
  const [datePreset, setDatePreset] = React.useState<'today' | '7days' | '30days' | 'lifetime'>('today')
  const [filterDate, setFilterDate] = React.useState<Date | undefined>(undefined)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [currentPage, setCurrentPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalItems, setTotalItems] = React.useState(0)
  const itemsPerPage = 10

  const loadProfitReport = React.useCallback(() => {
    setIsLoading(true)
    getAgentProfitReportAction({
      datePreset,
      filterDate: filterDate ? filterDate.toISOString() : undefined,
      searchQuery,
      page: currentPage,
      limit: itemsPerPage
    }).then((res) => {
      setIsLoading(false)
      if (res) {
        setSummary(res.summary)
        setPlayers(res.players)
        setTotalPages(res.totalPages)
        setTotalItems(res.totalItems)
      }
    }).catch(() => setIsLoading(false))
  }, [datePreset, filterDate, searchQuery, currentPage])

  React.useEffect(() => {
    loadProfitReport()
    const interval = setInterval(() => {
      loadProfitReport()
    }, 30000)
    return () => clearInterval(interval)
  }, [loadProfitReport])

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    loadProfitReport()
    setTimeout(() => setIsRefreshing(false), 600)
  }

  const handleResetFilters = () => {
    setDatePreset('today')
    setFilterDate(undefined)
    setSearchQuery('')
    setCurrentPage(1)
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      {/* Top Page Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-card border border-border/80 rounded-2xl shadow-xs">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground">Profit & Loss Report</h1>
              {isLoading || isRefreshing ? (
                <div className="h-5 w-14 bg-secondary/80 animate-pulse rounded-full" />
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {totalItems} Players Tracked
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs leading-tight hidden sm:block">
              Daily reset P/L tracking, lifetime revenue breakdown, and player-by-player cashier ledger.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Auto-Sync (30s)
          </span>
          <Button onClick={handleManualRefresh} variant="outline" size="sm" className="w-full sm:w-auto h-8 sm:h-9 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isLoading || isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* 📊 Top Summary KPI Metric Cards (5 Micro Cards Grid) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-3">
        {/* Card 1: Today's P/L */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>Today&apos;s P/L</span>
            <Activity className="h-3.5 w-3.5 text-emerald-500 shrink-0 hidden sm:block" />
          </div>
          {isLoading || isRefreshing ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className={`text-xs sm:text-lg font-black font-mono mt-0.5 truncate ${summary.todaysPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {summary.todaysPnl >= 0 ? '+' : ''}{formatCurrency(summary.todaysPnl)}
            </div>
          )}
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">Resets daily at 00:00</p>
        </Card>

        {/* Card 2: Lifetime P/L */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>Lifetime P/L</span>
            <Award className="h-3.5 w-3.5 text-primary shrink-0 hidden sm:block" />
          </div>
          {isLoading || isRefreshing ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className={`text-xs sm:text-lg font-black font-mono mt-0.5 truncate ${summary.lifetimePnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {summary.lifetimePnl >= 0 ? '+' : ''}{formatCurrency(summary.lifetimePnl)}
            </div>
          )}
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">All-time net earnings</p>
        </Card>

        {/* Card 3: Total Bet Volume */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>Total Bets (In)</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-blue-500 shrink-0 hidden sm:block" />
          </div>
          {isLoading || isRefreshing ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-xs sm:text-lg font-black font-mono text-foreground mt-0.5 truncate">
              {formatCurrency(summary.totalVolume)}
            </div>
          )}
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">Total wagered coins</p>
        </Card>

        {/* Card 4: Total Win Payouts */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>Total Wins (Out)</span>
            <ArrowDownRight className="h-3.5 w-3.5 text-amber-500 shrink-0 hidden sm:block" />
          </div>
          {isLoading || isRefreshing ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-xs sm:text-lg font-black font-mono text-amber-500 mt-0.5 truncate">
              {formatCurrency(summary.totalPayouts)}
            </div>
          )}
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">Returned to players</p>
        </Card>

        {/* Card 5: Net Margin % */}
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>House Margin</span>
            <Percent className="h-3.5 w-3.5 text-purple-400 shrink-0 hidden sm:block" />
          </div>
          {isLoading || isRefreshing ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className={`text-xs sm:text-lg font-black font-mono mt-0.5 truncate ${summary.netMarginPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {summary.netMarginPct.toFixed(1)}%
            </div>
          )}
          <p className="text-[9px] text-muted-foreground/70 hidden sm:block mt-0.5">Net margin percentage</p>
        </Card>
      </div>

      {/* Filter Toolbar Container */}
      <Card className="bg-card border-border/80 p-3 rounded-2xl shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
          {/* Left Side: Preset Pills & Calendar Date Picker */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] font-bold">
              {[
                { label: 'Today', value: 'today' },
                { label: 'Lifetime', value: 'lifetime' },
                { label: '7D', value: '7days' },
                { label: '30D', value: '30days' },
              ].map((btn) => (
                <button
                  key={btn.value}
                  onClick={() => {
                    setDatePreset(btn.value as any)
                    setFilterDate(undefined)
                    setCurrentPage(1)
                  }}
                  className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                    datePreset === btn.value && !filterDate
                      ? 'bg-primary text-primary-foreground font-black shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Custom Date Calendar */}
            <Popover>
              <PopoverTrigger className="h-8 px-2.5 text-[11px] font-extrabold border border-border/80 bg-card hover:bg-secondary/60 rounded-xl flex items-center justify-center cursor-pointer">
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                {filterDate ? filterDate.toLocaleDateString() : 'Custom Date'}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-card border-border" align="end">
                <Calendar
                  mode="single"
                  selected={filterDate}
                  onSelect={(d) => {
                    setFilterDate(d)
                    setCurrentPage(1)
                  }}
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
          </div>

          {/* Right Side: Player Search Bar */}
          <div className="flex items-center space-x-2">
            <div className="relative flex-1 md:w-56">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/70" />
              <Input
                placeholder="Search player username..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
                className="pl-8 h-8 text-xs bg-background/60 border-border rounded-xl"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {(searchQuery || filterDate || datePreset !== 'today') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="h-8 px-2 text-[10px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* 📋 Player P/L Audit Table (Desktop Table / Mobile Card Layout) */}
        <div className="rounded-xl border border-border/80 overflow-hidden bg-card">
          {isLoading || isRefreshing ? (
            <div className="p-4 space-y-2.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-secondary/20 animate-pulse border border-border/40">
                  <div className="h-3.5 bg-secondary/80 rounded w-1/4" />
                  <div className="h-3.5 bg-secondary/60 rounded w-1/3" />
                  <div className="h-3.5 bg-secondary/60 rounded w-1/4" />
                </div>
              ))}
            </div>
          ) : players.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-xs space-y-2">
              <Coins className="h-8 w-8 mx-auto opacity-30 text-primary" />
              <p className="font-extrabold">No player activity found for this period.</p>
              <p className="text-[11px] text-muted-foreground/70">Try adjusting your date range or search query.</p>
            </div>
          ) : (
            <>
              {/* Mobile View (< 640px) Cards */}
              <div className="block sm:hidden divide-y divide-border/60">
                {players.map((p) => (
                  <div key={p.id} className="p-3 space-y-2 hover:bg-secondary/20 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-black text-xs text-foreground font-mono">@{p.username}</span>
                        <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full ${
                          p.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                        }`}>
                          {p.isActive ? 'Active' : 'Blocked'}
                        </span>
                      </div>
                      <div className={`text-xs font-mono font-black ${p.netPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {p.netPnl >= 0 ? '+' : ''}{formatCurrency(p.netPnl)}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[10px] bg-secondary/30 p-2 rounded-lg border border-border/40">
                      <div>
                        <span className="text-muted-foreground block text-[9px]">Bets (In)</span>
                        <span className="font-mono font-bold text-foreground">{formatCurrency(p.totalBets)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[9px]">Wins (Out)</span>
                        <span className="font-mono font-bold text-amber-500">{formatCurrency(p.totalWins)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[9px]">Margin %</span>
                        <span className={`font-mono font-black ${p.marginPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {p.marginPct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop View (>= 640px) Table */}
              <div className="hidden sm:block overflow-x-auto">
                <Table>
                  <TableHeader className="bg-secondary/30 border-b border-border/60">
                    <TableRow>
                      <TableHead className="text-[11px] font-black uppercase tracking-wider">Player</TableHead>
                      <TableHead className="text-[11px] font-black uppercase tracking-wider text-center">Plays</TableHead>
                      <TableHead className="text-[11px] font-black uppercase tracking-wider text-right">Bets (Coins In)</TableHead>
                      <TableHead className="text-[11px] font-black uppercase tracking-wider text-right">Wins (Coins Out)</TableHead>
                      <TableHead className="text-[11px] font-black uppercase tracking-wider text-right">Net P/L (+/-)</TableHead>
                      <TableHead className="text-[11px] font-black uppercase tracking-wider text-right">Margin %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-border/60">
                    {players.map((p) => (
                      <TableRow key={p.id} className="hover:bg-secondary/20 transition-colors">
                        <TableCell className="py-2.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-black text-xs text-foreground font-mono">@{p.username}</span>
                            <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full ${
                              p.isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}>
                              {p.isActive ? 'Active' : 'Blocked'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 text-center font-mono text-xs font-bold text-muted-foreground">
                          {p.totalPlays}
                        </TableCell>
                        <TableCell className="py-2.5 text-right font-mono text-xs font-bold text-foreground">
                          {formatCurrency(p.totalBets)}
                        </TableCell>
                        <TableCell className="py-2.5 text-right font-mono text-xs font-bold text-amber-500">
                          {formatCurrency(p.totalWins)}
                        </TableCell>
                        <TableCell className={`py-2.5 text-right font-mono text-xs font-black ${p.netPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {p.netPnl >= 0 ? '+' : ''}{formatCurrency(p.netPnl)}
                        </TableCell>
                        <TableCell className={`py-2.5 text-right font-mono text-xs font-black ${p.marginPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {p.marginPct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {/* Table Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-3 border-t border-border/60 bg-secondary/10 flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground">
                Showing {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} Players
              </span>
              <ResponsivePagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                totalItems={totalItems}
                itemsPerPage={itemsPerPage}
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
