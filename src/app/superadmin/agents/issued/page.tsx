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
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Coins, CalendarIcon, ArrowUpRight, ArrowDownRight, RefreshCw, Filter, ShieldCheck, Search } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { getAgentsAction, getAgentCoinTransactionsAction } from '../actions'

export default function CoinsIssuedPage() {
  const [agents, setAgents] = React.useState<Array<{ id: string; name: string; username: string }>>([])
  const [transactions, setTransactions] = React.useState<Array<{
    id: string
    agentId: string
    agentName: string
    agentUsername: string
    type: 'deposit' | 'withdraw'
    amount: number
    date: string
  }>>([])

  const [summary, setSummary] = React.useState({ totalDeposited: 0, totalWithdrawn: 0, netIssued: 0 })
  const [currentPage, setCurrentPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalItems, setTotalItems] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [countdown, setCountdown] = React.useState(60)

  // Stable refs — avoids useCallback dep on filter state (interval leak fix)
  const selectedAgentIdRef = React.useRef('all')
  const selectedTypeRef = React.useRef<'all' | 'deposit' | 'withdraw'>('all')
  const filterDateRef = React.useRef<Date | undefined>(undefined)
  const datePresetRef = React.useRef<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all')
  const currentPageRef = React.useRef(1)
  const isInitialMountRef = React.useRef(true)

  // Filters state
  const [selectedAgentId, setSelectedAgentId] = React.useState('all')
  const [selectedType, setSelectedType] = React.useState<'all' | 'deposit' | 'withdraw'>('all')
  const [filterDate, setFilterDate] = React.useState<Date | undefined>(undefined)
  const [datePreset, setDatePreset] = React.useState<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all')
  const [searchTxQuery, setSearchTxQuery] = React.useState('')

  const itemsPerPage = 10

  // Load list of agents for dropdown filter
  React.useEffect(() => {
    getAgentsAction().then((res) => {
      if (res.agents) {
        setAgents(res.agents.map(a => ({ id: a.id, name: a.name, username: a.username })))
      }
    })
  }, [])

  const loadData = React.useCallback((isInitial: boolean = false) => {
    if (isInitial) setIsLoading(true)

    let startDate: string | undefined = undefined
    let endDate: string | undefined = undefined
    const fp = filterDateRef.current
    const dp = datePresetRef.current

    if (fp) {
      startDate = fp.toISOString()
      endDate = fp.toISOString()
    } else if (dp === 'today') {
      const now = new Date()
      const istTodayString = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const istTodayStart = new Date(`${istTodayString}T00:00:00+05:30`)
      startDate = istTodayStart.toISOString()
    } else if (dp === 'yesterday') {
      const now = new Date()
      const istYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const istYestString = istYesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const istYestStart = new Date(`${istYestString}T00:00:00+05:30`)
      const istYestEnd = new Date(`${istYestString}T23:59:59.999+05:30`)
      startDate = istYestStart.toISOString()
      endDate = istYestEnd.toISOString()
    } else if (dp === '7days') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      startDate = sevenDaysAgo.toISOString()
    } else if (dp === '30days') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      startDate = thirtyDaysAgo.toISOString()
    }

    getAgentCoinTransactionsAction({
      agentId: selectedAgentIdRef.current,
      type: selectedTypeRef.current,
      startDate,
      endDate,
      page: currentPageRef.current,
      limit: itemsPerPage
    }).then((res) => {
      setIsLoading(false)
      if (res) {
        setTransactions(res.transactions)
        setTotalPages(res.totalPages)
        setTotalItems(res.totalItems)
        setSummary(res.summary)
      }
    }).catch(() => setIsLoading(false))
  }, []) // stable — reads all filters from refs

  // Sync refs + re-fetch on any filter/page change
  React.useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId
    selectedTypeRef.current = selectedType
    filterDateRef.current = filterDate
    datePresetRef.current = datePreset
    currentPageRef.current = currentPage
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false
      return
    }
    loadData(false)
  }, [selectedAgentId, selectedType, filterDate, datePreset, currentPage, loadData])

  React.useEffect(() => {
    loadData(true)

    const countdownTick = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? 60 : prev - 1))
    }, 1000)

    const dataInterval = setInterval(() => {
      setCountdown(60)
      loadData(false) // silent: no skeleton
    }, 60000)

    return () => {
      clearInterval(countdownTick)
      clearInterval(dataInterval)
    }
  }, [loadData])

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    setCountdown(60)
    loadData(false)
    setTimeout(() => setIsRefreshing(false), 600)
  }

  const handleResetFilters = () => {
    setSelectedAgentId('all')
    setSelectedType('all')
    setFilterDate(undefined)
    setDatePreset('all')
    setSearchTxQuery('')
    setCurrentPage(1)
  }

  const filteredTransactions = transactions.filter(tx => {
    if (!searchTxQuery) return true
    const q = searchTxQuery.toLowerCase()
    return tx.id.toLowerCase().includes(q) ||
      tx.agentName.toLowerCase().includes(q) ||
      tx.agentUsername.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-card border border-border/80 rounded-2xl shadow-xs">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0">
            <Coins className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground">Coins Issued Ledger</h1>
            <p className="text-muted-foreground text-xs leading-tight hidden sm:block">
              Complete audit record of all coins issued and recalled by Super Admin to/from Agents.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Auto-Sync ({countdown}s)
          </span>
          <Button onClick={handleManualRefresh} variant="outline" size="sm" className="w-full sm:w-auto h-8 sm:h-9 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isLoading || isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-border/60 space-x-1">
        <Link
          href="/superadmin/agents"
          className="py-2 px-3 font-semibold text-xs text-muted-foreground hover:text-foreground border-b-2 border-transparent hover:border-border transition-all flex items-center space-x-1.5"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Agent Directory</span>
        </Link>
        <Link
          href="/superadmin/agents/issued"
          className="py-2 px-3 font-extrabold text-xs text-primary border-b-2 border-primary flex items-center space-x-1.5"
        >
          <Coins className="h-3.5 w-3.5" />
          <span>Coins Issued Ledger</span>
        </Link>
      </div>

      {/* Summary KPI Cards (3 Compact Cards) */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
        <Card className="bg-card border-border/80 p-2 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-muted-foreground">
            <span>Total Deposited</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500 shrink-0 hidden sm:block" />
          </div>
          {isLoading || isRefreshing ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-xs sm:text-base font-black font-mono text-emerald-500 mt-0.5 truncate">
              +{formatCurrency(summary.totalDeposited)}
            </div>
          )}
        </Card>

        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold text-muted-foreground">
            <span>Total Withdrawn</span>
            <ArrowDownRight className="h-3.5 w-3.5 text-red-500 shrink-0" />
          </div>
          {isLoading ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-sm sm:text-base font-black font-mono text-red-500 mt-0.5">
              -{formatCurrency(summary.totalWithdrawn)}
            </div>
          )}
        </Card>

        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold text-muted-foreground">
            <span>Net Issued</span>
            <Coins className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          </div>
          {isLoading ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-sm sm:text-base font-black font-mono text-foreground mt-0.5">
              {formatCurrency(summary.netIssued)}
            </div>
          )}
        </Card>
      </div>

      {/* Comprehensive Filter Bar */}
      <Card className="bg-card border-border/80 p-2.5 rounded-xl shadow-xs space-y-2">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
          {/* Controls Group */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Agent Select */}
            <div className="flex items-center space-x-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <select
                value={selectedAgentId}
                onChange={(e) => {
                  setSelectedAgentId(e.target.value)
                  setCurrentPage(1)
                }}
                className="h-8 px-2 rounded-lg border border-border bg-background text-foreground text-xs font-semibold focus:outline-none cursor-pointer"
              >
                <option value="all">All Agents</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} (@{a.username})
                  </option>
                ))}
              </select>
            </div>

            {/* Type Select */}
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value as any)
                setCurrentPage(1)
              }}
              className="h-8 px-2 rounded-lg border border-border bg-background text-foreground text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="deposit">Deposits (+)</option>
              <option value="withdraw">Withdrawals (-)</option>
            </select>

            {/* Date Quick Pills */}
            <div className="flex items-center space-x-1 border-l border-border/60 pl-2">
              {[
                { label: 'Lifetime', value: 'all' },
                { label: 'Today', value: 'today' },
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
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    datePreset === btn.value && !filterDate
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Calendar Popover */}
            <Popover>
              <PopoverTrigger className="h-8 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs font-medium flex items-center space-x-1.5 cursor-pointer hover:bg-secondary/40">
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{filterDate ? filterDate.toISOString().split('T')[0] : 'Custom Date'}</span>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 border-border bg-card">
                <Calendar
                  mode="single"
                  selected={filterDate}
                  onSelect={(d) => {
                    setFilterDate(d)
                    setDatePreset('all')
                    setCurrentPage(1)
                  }}
                  disabled={(date) => date > new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Search Tx Input & Reset */}
          <div className="flex items-center space-x-2">
            <div className="relative flex-1 lg:w-48">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/70" />
              <Input
                placeholder="Search Tx ID..."
                value={searchTxQuery}
                onChange={(e) => setSearchTxQuery(e.target.value)}
                className="pl-8 h-8 bg-background border-border text-foreground text-xs rounded-lg"
              />
            </div>

            {(selectedAgentId !== 'all' || selectedType !== 'all' || filterDate || datePreset !== 'all' || searchTxQuery) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="h-8 px-2 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer font-bold shrink-0"
              >
                Reset
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* --- DESKTOP TABLE VIEW (hidden on mobile < sm, visible sm+) --- */}
      <div className="hidden sm:block rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs">
        <div className="overflow-x-auto table-scroll">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider sticky left-0 bg-card z-10 py-2.5">Tx ID</TableHead>
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Agent</TableHead>
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Type</TableHead>
                <TableHead className="text-right text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Amount</TableHead>
                <TableHead className="text-right text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Date & Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell className="py-2.5"><div className="h-4 bg-secondary/80 rounded animate-pulse w-20" /></TableCell>
                    <TableCell className="py-2.5"><div className="h-4 bg-secondary/60 rounded animate-pulse w-28" /></TableCell>
                    <TableCell className="py-2.5"><div className="h-4 bg-secondary/70 rounded animate-pulse w-20" /></TableCell>
                    <TableCell className="text-right py-2.5"><div className="h-4 bg-secondary/80 rounded animate-pulse w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right py-2.5"><div className="h-4 bg-secondary/60 rounded animate-pulse w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredTransactions.length > 0 ? (
                filteredTransactions.map((tx) => (
                  <TableRow key={tx.id} className="border-border hover:bg-secondary/30 transition-colors">
                    <TableCell className="font-mono text-xs font-semibold text-foreground sticky left-0 bg-card z-10 py-2">
                      {tx.id.substring(0, 8)}...
                    </TableCell>
                    <TableCell className="text-foreground text-xs py-2">
                      <Link href={`/superadmin/agents/${tx.agentUsername}`} className="font-bold hover:underline text-primary">
                        {tx.agentName}
                      </Link>
                      <span className="text-muted-foreground block text-[10px]">@{tx.agentUsername}</span>
                    </TableCell>
                    <TableCell className="py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        tx.type === 'deposit'
                          ? 'bg-success-bg text-success-text border border-emerald-500/20'
                          : 'bg-danger-bg text-danger-text border border-red-500/20'
                      }`}>
                        {tx.type === 'deposit' ? <ArrowUpRight className="mr-1 h-3 w-3" /> : <ArrowDownRight className="mr-1 h-3 w-3" />}
                        {tx.type === 'deposit' ? 'Deposit (+)' : 'Withdrawal (-)'}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-mono font-black text-xs py-2 ${
                      tx.type === 'deposit' ? 'text-emerald-500' : 'text-red-500'
                    }`}>
                      {tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}
                    </TableCell>
                    <TableCell className="text-right text-[11px] text-muted-foreground font-mono py-2">
                      {tx.date}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-muted-foreground text-xs font-medium">
                    No coin transactions recorded for the selected filter parameters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {totalItems > itemsPerPage && (
          <ResponsivePagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
          />
        )}
      </div>

      {/* --- MOBILE VIEW CARDS (visible on mobile < sm, hidden on sm+) --- */}
      <div className="sm:hidden space-y-2.5">
        {isLoading ? (
          [1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-border/80 bg-card p-3 rounded-xl space-y-2 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-4 bg-secondary/80 rounded w-20" />
                <div className="h-4 bg-secondary/60 rounded-full w-20" />
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="h-3 bg-secondary/60 rounded w-1/3" />
                <div className="h-4 bg-secondary/80 rounded w-16" />
              </div>
            </Card>
          ))
        ) : filteredTransactions.length > 0 ? (
          filteredTransactions.map((tx) => (
            <Card key={tx.id} className="border-border/80 bg-card p-3 rounded-xl space-y-2 shadow-2xs relative overflow-hidden">
              <div className="flex items-center justify-between text-xs">
                <div className="font-mono font-bold text-foreground text-xs">
                  ID: {tx.id.substring(0, 8)}...
                </div>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  tx.type === 'deposit'
                    ? 'bg-success-bg text-success-text border border-emerald-500/20'
                    : 'bg-danger-bg text-danger-text border border-red-500/20'
                }`}>
                  {tx.type === 'deposit' ? <ArrowUpRight className="mr-1 h-3 w-3" /> : <ArrowDownRight className="mr-1 h-3 w-3" />}
                  {tx.type === 'deposit' ? 'Deposit' : 'Withdrawal'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs">
                <div>
                  <Link href={`/superadmin/agents/${tx.agentUsername}`} className="font-bold text-foreground hover:text-primary">
                    {tx.agentName}
                  </Link>
                  <span className="text-muted-foreground block text-[10px]">@{tx.agentUsername}</span>
                </div>
                <div className="text-right">
                  <div className={`font-mono font-black text-sm ${
                    tx.type === 'deposit' ? 'text-emerald-500' : 'text-red-500'
                  }`}>
                    {tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">{tx.date}</span>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <div className="p-6 text-center text-muted-foreground text-xs font-medium bg-card rounded-xl border border-border">
            No transactions found.
          </div>
        )}

        {totalItems > itemsPerPage && (
          <div className="pt-1">
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
    </div>
  )
}
