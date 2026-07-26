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
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCurrency } from "@/lib/utils"
import { ArrowDownRight, ArrowUpRight, Check, History, RefreshCw, Search, Filter, Coins } from "lucide-react"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { getAgentTransactionHistoryAction } from '../actions'

export default function HistoryPage() {
  const [transactions, setTransactions] = React.useState<Array<{ id: string; type: 'deposit' | 'withdraw'; amount: number; target: string; date: string; status: string }>>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [currentPage, setCurrentPage] = React.useState(1)
  
  // Filters state
  const [searchQuery, setSearchQuery] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<'all' | 'deposit' | 'withdraw'>('all')
  const [datePreset, setDatePreset] = React.useState<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all')

  const itemsPerPage = 10

  const loadHistory = React.useCallback(() => {
    setIsLoading(true)
    getAgentTransactionHistoryAction().then((res) => {
      setIsLoading(false)
      if (res.transactions) {
        setTransactions(res.transactions)
      }
    }).catch(() => setIsLoading(false))
  }, [])

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    loadHistory()
    setTimeout(() => setIsRefreshing(false), 600)
  }

  React.useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleResetFilters = () => {
    setSearchQuery('')
    setTypeFilter('all')
    setDatePreset('all')
    setCurrentPage(1)
  }

  const filteredTransactions = transactions.filter(txn => {
    const matchesSearch = !searchQuery ||
      txn.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      txn.target.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = typeFilter === 'all' || txn.type === typeFilter

    return matchesSearch && matchesType
  })

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage) || 1
  const paginatedTransactions = filteredTransactions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const totalDeposited = transactions.filter(t => t.type === 'deposit').reduce((acc, t) => acc + Number(t.amount || 0), 0)
  const totalWithdrawn = transactions.filter(t => t.type === 'withdraw').reduce((acc, t) => acc + Number(t.amount || 0), 0)
  const totalVolume = totalDeposited + totalWithdrawn

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-card border border-border/80 rounded-2xl shadow-xs">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <History className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground">Transaction History</h1>
              {isLoading ? (
                <div className="h-5 w-14 bg-secondary/80 animate-pulse rounded-full" />
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-primary/10 text-primary border border-primary/20">
                  {transactions.length} Total Logs
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs leading-tight hidden sm:block">
              Complete cashier audit record of all coin deposits and withdrawals made to your players.
            </p>
          </div>
        </div>

        <Button onClick={handleManualRefresh} variant="outline" size="sm" className="w-full sm:w-auto h-9 px-3 text-xs font-bold cursor-pointer rounded-xl border-border">
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh History
        </Button>
      </div>

      {/* Summary KPI Cards (3 Compact Cards) */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold text-muted-foreground">
            <span>Total Volume</span>
            <Coins className="h-3.5 w-3.5 text-primary shrink-0" />
          </div>
          {isLoading ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-sm sm:text-base font-black font-mono text-foreground mt-0.5">
              {formatCurrency(totalVolume)}
            </div>
          )}
        </Card>

        <Card className="bg-card border-border/80 p-2.5 sm:p-3 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold text-muted-foreground">
            <span>Total Deposited</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          </div>
          {isLoading ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-sm sm:text-base font-black font-mono text-emerald-500 mt-0.5">
              +{formatCurrency(totalDeposited)}
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
              -{formatCurrency(totalWithdrawn)}
            </div>
          )}
        </Card>
      </div>

      {/* Comprehensive Filter Toolbar */}
      <Card className="bg-card border-border/80 p-2.5 rounded-xl shadow-xs space-y-2">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/70" />
              <Input 
                placeholder="Search Tx ID or @player..." 
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
                className="pl-8 h-8 bg-background border-border text-foreground text-xs rounded-lg" 
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-[11px] text-muted-foreground hover:text-foreground font-bold cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Type Select */}
            <div className="flex items-center space-x-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value as any)
                  setCurrentPage(1)
                }}
                className="h-8 px-2 rounded-lg border border-border bg-background text-foreground text-xs font-semibold focus:outline-none cursor-pointer"
              >
                <option value="all">All Types</option>
                <option value="deposit">Deposits (+)</option>
                <option value="withdraw">Withdrawals (-)</option>
              </select>
            </div>

            {/* Quick Date Pills */}
            <div className="flex items-center space-x-1 border-l border-border/60 pl-2">
              {[
                { label: 'All', value: 'all' },
                { label: 'Today', value: 'today' },
                { label: '7D', value: '7days' },
                { label: '30D', value: '30days' },
              ].map((btn) => (
                <button
                  key={btn.value}
                  onClick={() => {
                    setDatePreset(btn.value as any)
                    setCurrentPage(1)
                  }}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    datePreset === btn.value
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {(searchQuery || typeFilter !== 'all' || datePreset !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="h-8 px-2 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer font-bold self-end sm:self-auto"
            >
              Reset
            </Button>
          )}
        </div>
      </Card>

      {/* --- DESKTOP TABLE VIEW (hidden on mobile < sm, visible sm+) --- */}
      <div className="hidden sm:block rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs">
        <div className="overflow-x-auto table-scroll">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider sticky left-0 bg-card z-10 py-2.5">Transaction ID</TableHead>
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Date & Time</TableHead>
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Type</TableHead>
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Player</TableHead>
                <TableHead className="text-right text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Amount</TableHead>
                <TableHead className="text-center text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell className="sticky left-0 bg-card z-10 py-2.5"><div className="h-4 bg-secondary/80 rounded animate-pulse w-24" /></TableCell>
                    <TableCell className="py-2.5"><div className="h-4 bg-secondary/60 rounded animate-pulse w-28" /></TableCell>
                    <TableCell className="py-2.5"><div className="h-4 bg-secondary/70 rounded animate-pulse w-16" /></TableCell>
                    <TableCell className="py-2.5"><div className="h-4 bg-secondary/80 rounded animate-pulse w-20" /></TableCell>
                    <TableCell className="text-right py-2.5"><div className="h-4 bg-secondary/70 rounded animate-pulse w-16 ml-auto" /></TableCell>
                    <TableCell className="text-center py-2.5"><div className="h-4 bg-secondary/60 rounded animate-pulse w-14 mx-auto" /></TableCell>
                  </TableRow>
                ))
              ) : paginatedTransactions.length > 0 ? (
                paginatedTransactions.map((txn) => (
                  <TableRow key={txn.id} className="border-border hover:bg-secondary/30 transition-colors">
                    <TableCell className="font-mono text-xs font-semibold text-foreground sticky left-0 bg-card z-10 py-2">
                      {txn.id}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground font-mono py-2">{txn.date}</TableCell>
                    <TableCell className="py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        txn.type === 'deposit'
                          ? 'bg-success-bg text-success-text border border-emerald-500/20'
                          : 'bg-danger-bg text-danger-text border border-red-500/20'
                      }`}>
                        {txn.type === 'deposit' ? <ArrowUpRight className="mr-1 h-3 w-3" /> : <ArrowDownRight className="mr-1 h-3 w-3" />}
                        {txn.type === 'deposit' ? 'Deposit' : 'Withdraw'}
                      </span>
                    </TableCell>
                    <TableCell className="text-foreground font-bold text-xs py-2">@{txn.target}</TableCell>
                    <TableCell className={`text-right font-mono font-black text-xs py-2 ${
                      txn.type === 'deposit' ? 'text-emerald-500' : 'text-red-500'
                    }`}>
                      {txn.type === 'deposit' ? '+' : '-'}{formatCurrency(txn.amount)}
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-500 px-2 py-0.5 text-[10px] font-extrabold border border-emerald-500/20">
                        <Check className="mr-0.5 h-3 w-3" /> {txn.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-28 text-center text-muted-foreground text-xs font-medium">
                    No transactions recorded matching filter criteria.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {filteredTransactions.length > itemsPerPage && (
          <ResponsivePagination 
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={filteredTransactions.length}
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
                <div className="h-4 bg-secondary/60 rounded-full w-16" />
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="h-3.5 bg-secondary/60 rounded w-1/4" />
                <div className="h-4 bg-secondary/80 rounded w-16" />
              </div>
            </Card>
          ))
        ) : paginatedTransactions.length > 0 ? (
          paginatedTransactions.map((txn) => (
            <Card key={txn.id} className="border-border/80 bg-card p-3 rounded-xl space-y-2 shadow-2xs relative overflow-hidden">
              <div className="flex items-center justify-between text-xs">
                <div className="font-mono font-bold text-foreground text-xs">
                  ID: {txn.id}
                </div>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  txn.type === 'deposit'
                    ? 'bg-success-bg text-success-text border border-emerald-500/20'
                    : 'bg-danger-bg text-danger-text border border-red-500/20'
                }`}>
                  {txn.type === 'deposit' ? <ArrowUpRight className="mr-1 h-3 w-3" /> : <ArrowDownRight className="mr-1 h-3 w-3" />}
                  {txn.type === 'deposit' ? 'Deposit' : 'Withdraw'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs">
                <div>
                  <span className="font-extrabold text-foreground text-xs block">@{txn.target}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{txn.date}</span>
                </div>
                <div className="text-right">
                  <div className={`font-mono font-black text-sm ${
                    txn.type === 'deposit' ? 'text-emerald-500' : 'text-red-500'
                  }`}>
                    {txn.type === 'deposit' ? '+' : '-'}{formatCurrency(txn.amount)}
                  </div>
                  <span className="inline-flex items-center text-emerald-500 text-[10px] font-bold">
                    <Check className="mr-0.5 h-2.5 w-2.5" /> Done
                  </span>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <div className="p-6 text-center text-muted-foreground text-xs font-medium bg-card rounded-xl border border-border">
            No transactions found.
          </div>
        )}

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
      </div>
    </div>
  )
}
