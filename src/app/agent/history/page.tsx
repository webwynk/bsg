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
import { Input } from "@/components/ui/input"
import { formatCurrency } from "@/lib/utils"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { ResponsivePagination } from "@/components/responsive-pagination"

const MOCK_TRANSACTIONS = [
  { id: 'TXN-1029', type: 'withdraw', amount: 500000, target: 'rahul99', date: '2023-10-24 14:32', status: 'Completed' },
  { id: 'TXN-1028', type: 'deposit', amount: 120000, target: 'vikram_k', date: '2023-10-24 11:15', status: 'Completed' },
  { id: 'TXN-1027', type: 'deposit', amount: 50000, target: 'neha_r', date: '2023-10-23 09:45', status: 'Completed' },
  { id: 'TXN-1026', type: 'withdraw', amount: 1000000, target: 'rahul99', date: '2023-10-22 18:20', status: 'Completed' },
  { id: 'TXN-1025', type: 'deposit', amount: 300000, target: 'amit_p', date: '2023-10-21 12:10', status: 'Completed' },
]

export default function HistoryPage() {
  const [currentPage, setCurrentPage] = React.useState(1)
  const itemsPerPage = 3
  const totalPages = Math.ceil(MOCK_TRANSACTIONS.length / itemsPerPage)
  const paginatedTransactions = MOCK_TRANSACTIONS.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Transaction History</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          View all deposits and withdrawals made to your players.
        </p>
      </div>

      <div className="flex items-center justify-between mb-4">
        <Input 
          placeholder="Search by transaction ID or username..." 
          className="max-w-sm bg-card border-border text-foreground" 
        />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Horizontal table scroll wrapper */}
        <div className="overflow-x-auto table-scroll">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] min-w-[140px]">Transaction ID</TableHead>
                <TableHead className="text-muted-foreground min-w-[150px]">Date & Time</TableHead>
                <TableHead className="text-muted-foreground min-w-[120px]">Type</TableHead>
                <TableHead className="text-muted-foreground min-w-[120px]">Player</TableHead>
                <TableHead className="text-right text-muted-foreground min-w-[120px]">Amount</TableHead>
                <TableHead className="text-center text-muted-foreground min-w-[120px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTransactions.map((txn) => (
                <TableRow key={txn.id} className="border-border hover:bg-secondary/50">
                  <TableCell className="font-semibold text-foreground sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">{txn.id}</TableCell>
                  <TableCell className="text-muted-foreground">{txn.date}</TableCell>
                  <TableCell>
                    {txn.type === 'deposit' ? (
                      <span className="inline-flex items-center text-success-text text-xs font-bold">
                        <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> Deposit
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-danger-text text-xs font-bold">
                        <ArrowDownRight className="mr-1 h-3.5 w-3.5" /> Withdraw
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-foreground font-semibold">@{txn.target}</TableCell>
                  <TableCell className={`text-right font-mono font-bold ${txn.type === 'deposit' ? 'text-success-text' : 'text-danger-text'}`}>
                    {txn.type === 'deposit' ? '+' : '-'}{formatCurrency(txn.amount)}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center rounded-full bg-secondary/80 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                      {txn.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <ResponsivePagination 
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={MOCK_TRANSACTIONS.length}
          itemsPerPage={itemsPerPage}
        />
      </div>
    </div>
  )
}
