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
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Coins, CalendarIcon, ArrowUpRight, ArrowDownRight, RefreshCw, Filter, ShieldCheck, Search, Users, Download } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { pickedDayKey } from "@/lib/date-range"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { ErrorBanner } from "@/components/error-banner"
import { getAgentsAction, getAgentCoinLedgerAction, getAgentCoinLedgerBreakdownAction, exportAgentCoinLedgerAction } from '../actions'
import { useLiveVersion, useLiveConnectionStatus } from '@/components/live-data-provider'
import { useRequestGeneration } from '@/hooks/use-request-generation'

export default function CoinsIssuedPage() {
  const [agents, setAgents] = React.useState<Array<{ id: string; full_name: string; username: string }>>([])
  // Issue #15: for the main ledger table (loadData) specifically -- the
  // dropdown-filler and breakdown-panel fetches below are secondary/
  // supplementary, guarded against corrupting state on failure but not
  // worth a full-page banner of their own for a filter dropdown.
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [transactions, setTransactions] = React.useState<Array<{
    id: string
    agent_id: string
    agent_name: string
    agent_username: string
    direction: 'credit' | 'debit'
    amount: number
    balance_after: number
    note: string | null
    created_at: string
    created_at_iso: string
  }>>([])

  const [summary, setSummary] = React.useState({ credited: 0, debited: 0, net: 0 })
  const [breakdown, setBreakdown] = React.useState<Array<{
    agent_id: string
    agent_name: string
    agent_username: string
    credited: number
    debited: number
    net: number
  }>>([])
  const [showBreakdown, setShowBreakdown] = React.useState(false)
  const [isExporting, setIsExporting] = React.useState(false)
  const [currentPage, setCurrentPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalItems, setTotalItems] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const isLive = useLiveConnectionStatus()

  // Stable refs — avoids useCallback dep on filter state (interval leak fix)
  const selectedAgentIdRef = React.useRef('all')
  const selectedTypeRef = React.useRef<'all' | 'credit' | 'debit'>('all')
  const filterDateRef = React.useRef<Date | undefined>(undefined)
  const datePresetRef = React.useRef<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all')
  const searchRef = React.useRef('')
  const currentPageRef = React.useRef(1)
  const isInitialMountRef = React.useRef(true)

  // Filters state
  const [selectedAgentId, setSelectedAgentId] = React.useState('all')
  const [selectedType, setSelectedType] = React.useState<'all' | 'credit' | 'debit'>('all')
  const [filterDate, setFilterDate] = React.useState<Date | undefined>(undefined)
  const [datePreset, setDatePreset] = React.useState<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all')
  const [searchTxQuery, setSearchTxQuery] = React.useState('')

  const itemsPerPage = 10

  // Load list of agents for dropdown filter
  React.useEffect(() => {
    getAgentsAction().then((res) => {
      if (!res.error) {
        setAgents(res.agents.map(a => ({ id: a.id, full_name: a.full_name, username: a.username })))
      }
    })
  }, [])

  // Shared by loadData, the breakdown fetch, and CSV export -- all three must
  // agree on exactly the same date range as whatever the user has filtered to.
  const computeDateRange = React.useCallback((): { startDate?: string; endDate?: string } => {
    let startDate: string | undefined = undefined
    let endDate: string | undefined = undefined
    const fp = filterDateRef.current
    const dp = datePresetRef.current

    if (fp) {
      // Issue #19 FIX: this used to send the exact same instant as both
      // bounds (a zero-width window). Now builds proper IST day boundaries,
      // matching the 'yesterday' preset's already-correct pattern below.
      //
      // Issue #90 FIX: the boundary construction above was correct, but `fp`
      // itself -- the raw Date the Calendar widget returns -- encodes local
      // midnight in the BROWSER's own timezone, not IST midnight. Re-labeling
      // that instant as an IST day via toLocaleDateString(...) answers the
      // wrong question for any browser east of IST by more than +5:30
      // (Bangkok, Singapore, China, Japan, Korea, Australia, NZ) -- local
      // midnight of the picked day already falls on the PREVIOUS IST calendar
      // day for those timezones. pickedDayKey() reads back exactly the
      // year/month/day the widget was given, with no timezone conversion --
      // an exact round trip of what was actually clicked, regardless of
      // browser timezone.
      const istFpString = pickedDayKey(fp)
      const istFpStart = new Date(`${istFpString}T00:00:00+05:30`)
      const istFpEnd = new Date(`${istFpString}T23:59:59.999+05:30`)
      startDate = istFpStart.toISOString()
      endDate = istFpEnd.toISOString()
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
    return { startDate, endDate }
  }, [])

  const ledgerRequest = useRequestGeneration()
  const loadData = React.useCallback((isInitial: boolean = false) => {
    if (isInitial) setIsLoading(true)
    const { startDate, endDate } = computeDateRange()
    const token = ledgerRequest.nextGeneration()

    getAgentCoinLedgerAction({
      agentId: selectedAgentIdRef.current,
      direction: selectedTypeRef.current,
      startDate,
      endDate,
      search: searchRef.current,
      page: currentPageRef.current,
      limit: itemsPerPage
    }).then((res) => {
      if (!ledgerRequest.isCurrent(token)) return
      setIsLoading(false)
      setIsRefreshing(false)
      setLoadError(res.error)
      if (!res.error) {
        setTransactions(res.rows)
        setTotalPages(res.total_pages)
        setTotalItems(res.total_items)
        setSummary(res.summary)
      }
    }).catch((e) => {
      if (!ledgerRequest.isCurrent(token)) return
      setIsLoading(false)
      setIsRefreshing(false)
      setLoadError(e instanceof Error ? e.message : 'Could not load ledger.')
    })
  }, [computeDateRange, ledgerRequest])

  // Per-agent breakdown -- same filters as the table (minus the single-agent
  // filter, and minus pagination), fetched only while the panel is open so a
  // superadmin who never opens it never pays for the extra query.
  const loadBreakdown = React.useCallback(() => {
    const { startDate, endDate } = computeDateRange()
    getAgentCoinLedgerBreakdownAction({
      startDate, endDate, search: searchRef.current,
    }).then((res) => {
      if (!res.error) setBreakdown(res.rows)
    })
  }, [computeDateRange])

  React.useEffect(() => {
    if (showBreakdown) loadBreakdown()
  }, [showBreakdown, selectedAgentId, selectedType, filterDate, datePreset, searchTxQuery, loadBreakdown])

  const handleExportCsv = () => {
    setIsExporting(true)
    const { startDate, endDate } = computeDateRange()
    exportAgentCoinLedgerAction({
      agentId: selectedAgentIdRef.current,
      direction: selectedTypeRef.current,
      startDate, endDate, search: searchRef.current,
    }).then((res) => {
      setIsExporting(false)
      setLoadError(res.error)
      if (res.error || !res?.rows?.length) return
      const header = ['Agent', 'Direction', 'Amount', 'Balance After', 'Reason', 'Date & Time']
      const escapeCsv = (v: string) => `"${v.replace(/"/g, '""')}"`
      const lines = [header.join(',')]
      for (const r of res.rows) {
        lines.push([
          escapeCsv(`@${r.agent_username}`),
          r.direction === 'credit' ? 'Deposit' : 'Withdrawal',
          String(r.amount),
          String(r.balance_after),
          escapeCsv(r.note),
          escapeCsv(r.created_at),
        ].join(','))
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `coins-issued-ledger-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }).catch((e) => {
      setIsExporting(false)
      setLoadError(e instanceof Error ? e.message : 'Could not export ledger.')
    })
  }

  // Sync refs + re-fetch on any filter/page change
  React.useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId
    selectedTypeRef.current = selectedType
    filterDateRef.current = filterDate
    datePresetRef.current = datePreset
    currentPageRef.current = currentPage
    searchRef.current = searchTxQuery
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false
      return
    }
    loadData(false)
  }, [selectedAgentId, selectedType, filterDate, datePreset, currentPage, searchTxQuery, loadData])

  // Issue #91 Phase 5: replaces the old 60s setInterval poll. liveTick comes
  // from the single shared Realtime connection (LiveDataProvider, mounted
  // once in superadmin/layout.tsx) and changes the instant a coin_ledger row
  // changes, plus once every 90s as a fallback. Matches getAgentCoinLedgerAction's
  // actual query scope (coin_ledger; profiles is only touched for resolving a
  // free-text search term, not a data dependency worth tracking live).
  //
  // loadData's isInitial flag needs a real "have I ever loaded before" check,
  // not liveTick's own value -- LiveDataProvider is mounted once per portal
  // and its counters persist across client-side navigation between pages, so
  // liveTick can already be nonzero the moment this page mounts (e.g. arriving
  // here from another page after something changed elsewhere). A ref, same
  // pattern as isInitialMountRef above, tracks this correctly regardless.
  const hasLoadedOnceRef = React.useRef(false)
  const liveTick = useLiveVersion(['coin_ledger'])
  React.useEffect(() => {
    loadData(!hasLoadedOnceRef.current)
    hasLoadedOnceRef.current = true
  }, [liveTick, loadData])

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    loadData(false) // cleared by loadData's own completion above
  }

  const handleResetFilters = () => {
    setSelectedAgentId('all')
    setSelectedType('all')
    setFilterDate(undefined)
    setDatePreset('all')
    setSearchTxQuery('')
    setCurrentPage(1)
  }

  // B-6: the search is applied server-side, so this is the full result set
  // for the current page rather than a second filter over ten rows.
  const filteredTransactions = transactions

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      <ErrorBanner error={loadError} />

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
          <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl border ${
            isLive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-secondary/40 text-muted-foreground border-border/60'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/60'}`} />
            {isLive ? 'Live Sync' : 'Connecting…'}
          </span>
          <Button
            onClick={() => setShowBreakdown(v => !v)}
            variant="outline"
            size="sm"
            className={`w-full sm:w-auto h-8 sm:h-9 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border ${showBreakdown ? 'bg-primary/10 text-primary border-primary/40' : ''}`}
          >
            <Users className="mr-1.5 h-3.5 w-3.5" /> By Agent
          </Button>
          <Button
            onClick={handleExportCsv}
            disabled={isExporting}
            variant="outline"
            size="sm"
            className="w-full sm:w-auto h-8 sm:h-9 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border"
          >
            <Download className={`mr-1.5 h-3.5 w-3.5 ${isExporting ? 'animate-pulse' : ''}`} /> {isExporting ? 'Exporting...' : 'Export CSV'}
          </Button>
          <Button onClick={handleManualRefresh} disabled={isRefreshing} variant="outline" size="sm" className="w-full sm:w-auto h-8 sm:h-9 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border">
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
              +{formatCurrency(summary.credited)}
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
              -{formatCurrency(summary.debited)}
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
              {formatCurrency(summary.net)}
            </div>
          )}
        </Card>
      </div>

      {/* Per-Agent Breakdown -- toggled via the "By Agent" button. A single
          net total across every agent hides which one it actually came from. */}
      {showBreakdown && (
        <Card className="bg-card border-border/80 p-3 rounded-xl shadow-xs">
          <h2 className="text-xs font-black text-foreground mb-2">Breakdown by Agent (current filters)</h2>
          {breakdown.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">No agent activity for the selected filters.</p>
          ) : (
            <div className="overflow-x-auto table-scroll">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider">Agent</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[11px] uppercase tracking-wider">Deposited</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[11px] uppercase tracking-wider">Withdrawn</TableHead>
                    <TableHead className="text-right text-muted-foreground text-[11px] uppercase tracking-wider">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breakdown.map((row) => (
                    <TableRow key={row.agent_id} className="border-border hover:bg-secondary/30">
                      <TableCell className="text-xs py-2">
                        <Link href={`/superadmin/agents/${row.agent_username.replace('@', '')}`} className="font-bold hover:underline text-primary">
                          {row.agent_name}
                        </Link>
                        <span className="text-muted-foreground block text-[10px]">{row.agent_username}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-500 py-2">+{formatCurrency(row.credited)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-red-500 py-2">-{formatCurrency(row.debited)}</TableCell>
                      <TableCell className={`text-right font-mono font-black text-xs py-2 ${row.net >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {row.net >= 0 ? '+' : ''}{formatCurrency(row.net)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

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
                    {a.full_name} (@{a.username})
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
              <option value="credit">Deposits (+)</option>
              <option value="debit">Withdrawals (-)</option>
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
                {/* Issue #90 fix: this label used to show `.toISOString()`'s
                    UTC-shifted date, which could disagree with both the day
                    actually clicked AND (before the fix above) the data being
                    shown. pickedDayKey() matches what the filter itself now
                    uses, so label and data can never disagree again. */}
                <span>{filterDate ? pickedDayKey(filterDate) : 'Custom Date'}</span>
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
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Reason</TableHead>
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
                    <TableCell className="py-2.5"><div className="h-4 bg-secondary/60 rounded animate-pulse w-24" /></TableCell>
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
                      <Link href={`/superadmin/agents/${tx.agent_username}`} className="font-bold hover:underline text-primary">
                        {tx.agent_name}
                      </Link>
                      <span className="text-muted-foreground block text-[10px]">@{tx.agent_username}</span>
                    </TableCell>
                    <TableCell className="py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        tx.direction === 'credit'
                          ? 'bg-success-bg text-success-text border border-emerald-500/20'
                          : 'bg-danger-bg text-danger-text border border-red-500/20'
                      }`}>
                        {tx.direction === 'credit' ? <ArrowUpRight className="mr-1 h-3 w-3" /> : <ArrowDownRight className="mr-1 h-3 w-3" />}
                        {tx.direction === 'credit' ? 'Deposit (+)' : 'Withdrawal (-)'}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-mono font-black text-xs py-2 ${
                      tx.direction === 'credit' ? 'text-emerald-500' : 'text-red-500'
                    }`}>
                      {tx.direction === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground py-2 max-w-[220px] truncate" title={tx.note ?? ''}>
                      {tx.note || <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-[11px] text-muted-foreground font-mono py-2">
                      {tx.created_at}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-28 text-center text-muted-foreground text-xs font-medium">
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
                  tx.direction === 'credit'
                    ? 'bg-success-bg text-success-text border border-emerald-500/20'
                    : 'bg-danger-bg text-danger-text border border-red-500/20'
                }`}>
                  {tx.direction === 'credit' ? <ArrowUpRight className="mr-1 h-3 w-3" /> : <ArrowDownRight className="mr-1 h-3 w-3" />}
                  {tx.direction === 'credit' ? 'Deposit' : 'Withdrawal'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs">
                <div>
                  <Link href={`/superadmin/agents/${tx.agent_username}`} className="font-bold text-foreground hover:text-primary">
                    {tx.agent_name}
                  </Link>
                  <span className="text-muted-foreground block text-[10px]">@{tx.agent_username}</span>
                </div>
                <div className="text-right">
                  <div className={`font-mono font-black text-sm ${
                    tx.direction === 'credit' ? 'text-emerald-500' : 'text-red-500'
                  }`}>
                    {tx.direction === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">{tx.created_at}</span>
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
