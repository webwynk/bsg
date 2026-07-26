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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Coins, CalendarIcon, ArrowUpRight, ArrowDownRight, RefreshCw, Filter, Layers } from "lucide-react"
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

  // Filters state
  const [selectedAgentId, setSelectedAgentId] = React.useState('all')
  const [selectedType, setSelectedType] = React.useState<'all' | 'deposit' | 'withdraw'>('all')
  const [filterDate, setFilterDate] = React.useState<Date | undefined>(undefined)
  const [datePreset, setDatePreset] = React.useState<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all')

  const itemsPerPage = 10

  // Load list of agents for dropdown filter
  React.useEffect(() => {
    getAgentsAction().then((res) => {
      if (res.agents) {
        setAgents(res.agents.map(a => ({ id: a.id, name: a.name, username: a.username })))
      }
    })
  }, [])

  const loadData = React.useCallback(() => {
    setIsLoading(true)

    let startDate: string | undefined = undefined
    let endDate: string | undefined = undefined

    if (filterDate) {
      startDate = filterDate.toISOString()
      endDate = filterDate.toISOString()
    } else if (datePreset === 'today') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      startDate = today.toISOString()
    } else if (datePreset === 'yesterday') {
      const yest = new Date()
      yest.setDate(yest.getDate() - 1)
      yest.setHours(0, 0, 0, 0)
      startDate = yest.toISOString()

      const yestEnd = new Date()
      yestEnd.setDate(yestEnd.getDate() - 1)
      yestEnd.setHours(23, 59, 59, 999)
      endDate = yestEnd.toISOString()
    } else if (datePreset === '7days') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      startDate = sevenDaysAgo.toISOString()
    } else if (datePreset === '30days') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      startDate = thirtyDaysAgo.toISOString()
    }

    getAgentCoinTransactionsAction({
      agentId: selectedAgentId,
      type: selectedType,
      startDate,
      endDate,
      page: currentPage,
      limit: itemsPerPage
    }).then((res) => {
      setIsLoading(false)
      if (res) {
        setTransactions(res.transactions)
        setTotalPages(res.totalPages)
        setTotalItems(res.totalItems)
        setSummary(res.summary)
      }
    })
  }, [selectedAgentId, selectedType, filterDate, datePreset, currentPage])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const handleResetFilters = () => {
    setSelectedAgentId('all')
    setSelectedType('all')
    setFilterDate(undefined)
    setDatePreset('all')
    setCurrentPage(1)
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      {/* Page Title & Sub Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Coins Issued Ledger</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Complete audit record of all coins issued and recalled by Super Admin to/from Agents.
          </p>
        </div>

        <Button onClick={loadData} variant="outline" size="sm" className="w-fit self-start md:self-auto cursor-pointer">
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh Ledger
        </Button>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-border/60 space-x-2">
        <Link
          href="/superadmin/agents"
          className="py-2.5 px-4 font-semibold text-sm text-muted-foreground hover:text-foreground border-b-2 border-transparent hover:border-border transition-all"
        >
          Agent Directory
        </Link>
        <Link
          href="/superadmin/agents/issued"
          className="py-2.5 px-4 font-bold text-sm text-primary border-b-2 border-primary"
        >
          Coins Issued Ledger
        </Link>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Deposited</span>
            <ArrowUpRight className="h-5 w-5 text-emerald-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-2xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
              +{formatCurrency(summary.totalDeposited)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Total coins given to agents</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Withdrawn</span>
            <ArrowDownRight className="h-5 w-5 text-red-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-2xl font-bold font-mono tracking-tight text-red-600 dark:text-red-400">
              -{formatCurrency(summary.totalWithdrawn)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Total coins recalled from agents</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Net Issued</span>
            <Coins className="h-5 w-5 text-amber-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
              {formatCurrency(summary.netIssued)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Net coins circulating in agency accounts</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="bg-card border-border p-4 rounded-xl shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Agent Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={selectedAgentId}
                onChange={(e) => {
                  setSelectedAgentId(e.target.value)
                  setCurrentPage(1)
                }}
                className="h-9 px-3 rounded-lg border border-border bg-background text-foreground text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                <option value="all">All Agents</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} (@{a.username})
                  </option>
                ))}
              </select>
            </div>

            {/* Type Filter */}
            <div className="flex items-center space-x-2">
              <select
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value as 'all' | 'deposit' | 'withdraw')
                  setCurrentPage(1)
                }}
                className="h-9 px-3 rounded-lg border border-border bg-background text-foreground text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                <option value="all">All Types</option>
                <option value="deposit">Deposits Only (+)</option>
                <option value="withdraw">Withdrawals Only (-)</option>
              </select>
            </div>

            {/* Date Preset Buttons */}
            <div className="flex items-center space-x-1 border-l border-border pl-3">
              {[
                { label: 'All Time', value: 'all' },
                { label: 'Today', value: 'today' },
                { label: 'Yesterday', value: 'yesterday' },
                { label: '7 Days', value: '7days' },
                { label: '30 Days', value: '30days' },
              ].map((btn) => (
                <button
                  key={btn.value}
                  onClick={() => {
                    setDatePreset(btn.value as any)
                    setFilterDate(undefined)
                    setCurrentPage(1)
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    datePreset === btn.value && !filterDate
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Custom Date Picker */}
            <Popover>
              <PopoverTrigger className="h-9 px-3 rounded-lg border border-border bg-background text-foreground text-xs font-normal flex items-center space-x-2 cursor-pointer hover:bg-secondary/40">
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                {filterDate ? filterDate.toISOString().split('T')[0] : <span>Custom Date</span>}
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
                />
              </PopoverContent>
            </Popover>
          </div>

          {(selectedAgentId !== 'all' || selectedType !== 'all' || filterDate || datePreset !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="text-xs text-muted-foreground hover:text-foreground h-8 cursor-pointer"
            >
              Reset Filters
            </Button>
          )}
        </div>
      </Card>

      {/* Ledger Data Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto table-scroll">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] min-w-[140px]">Transaction ID</TableHead>
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[150px]">Agent</TableHead>
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[120px]">Type</TableHead>
                <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[120px]">Amount</TableHead>
                <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[160px]">Date & Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length > 0 ? (
                transactions.map((tx) => (
                  <TableRow key={tx.id} className="border-border hover:bg-secondary/40">
                    <TableCell className="font-mono text-xs font-semibold text-foreground sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                      {tx.id.substring(0, 8)}...
                    </TableCell>
                    <TableCell className="text-foreground text-xs">
                      <Link href={`/superadmin/agents/${tx.agentId}`} className="font-bold hover:underline text-primary">
                        {tx.agentName}
                      </Link>
                      <span className="text-muted-foreground block text-[11px]">@{tx.agentUsername}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        tx.type === 'deposit'
                          ? 'bg-success-bg text-success-text'
                          : 'bg-danger-bg text-danger-text'
                      }`}>
                        {tx.type === 'deposit' ? <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> : <ArrowDownRight className="mr-1 h-3.5 w-3.5" />}
                        {tx.type === 'deposit' ? 'Deposit (+)' : 'Withdrawal (-)'}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-mono font-bold text-sm ${
                      tx.type === 'deposit' ? 'text-success-text' : 'text-danger-text'
                    }`}>
                      {tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground font-mono">
                      {tx.date}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center text-muted-foreground text-xs font-medium">
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
    </div>
  )
}
