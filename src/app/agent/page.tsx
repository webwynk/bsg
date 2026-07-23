"use client"

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Wallet, Users, ArrowUpRight, ArrowDownRight, RefreshCw, Send, Check } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"
import { getPlayersAction } from './players/actions'

export default function AgentDashboard() {
  const [players, setPlayers] = React.useState<Array<{ id: string; name: string; username: string; balance: number }>>([])
  const [recentTransactions] = React.useState<Array<{ id: string; type: 'deposit' | 'withdraw'; amount: number; target: string; date: string }>>([])
  const [balance] = React.useState(0)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  const fetchPlayers = () => {
    getPlayersAction().then((res) => {
      if (res.players) {
        setPlayers(res.players)
      }
    })
  }

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    fetchPlayers()
    setTimeout(() => setIsRefreshing(false), 500)
  }

  React.useEffect(() => {
    let isMounted = true
    getPlayersAction().then((res) => {
      if (isMounted && res.players) {
        setPlayers(res.players)
      }
    })
    return () => {
      isMounted = false
    }
  }, [])

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Agent Cashier</h1>
        <p className="text-muted-foreground mt-1">
          Quick point transfers and player activity snapshot.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card border-border text-foreground">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Available Balance</CardTitle>
            <Wallet className="h-4 w-4 text-success-text" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{formatCurrency(balance)}</div>
            <p className="text-xs text-muted-foreground mt-1">Points available to allocate</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border text-foreground">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">My Players</CardTitle>
            <Users className="h-4 w-4 text-info-text" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{players.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Registered players network</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border text-foreground">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Today&apos;s Profit/Loss</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-success-text" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success-text font-mono">{formatCurrency(0)}</div>
            <p className="text-xs text-muted-foreground mt-1">Based on player win/loss records</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Quick Point Transfer Widget */}
        <Card className="bg-card border-border text-foreground">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Send className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Quick Point Transfer</CardTitle>
            </div>
            <CardDescription className="text-muted-foreground">
              Instantly deposit or withdraw points for any player.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="player-select">Select Player</Label>
              <select 
                id="player-select"
                className="w-full h-10 px-3 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                <option value="">-- Choose a Player --</option>
                {players.map(p => (
                  <option key={p.id} value={p.username}>
                    {p.name} (@{p.username}) - {formatCurrency(p.balance)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quick-amount">Amount (INR)</Label>
              <Input 
                id="quick-amount" 
                type="number" 
                placeholder="1000" 
                className="bg-background border-border text-foreground"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <Button className="bg-success text-white hover:bg-success/90 cursor-pointer">
                <ArrowUpRight className="mr-1 h-4 w-4" /> Quick Deposit
              </Button>
              <Button variant="destructive" className="cursor-pointer">
                <ArrowDownRight className="mr-1 h-4 w-4" /> Quick Withdraw
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity Snapshot */}
        <Card className="bg-card border-border text-foreground">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle>Recent Point Transfers</CardTitle>
              <CardDescription className="text-muted-foreground">
                Your latest cashier transfer transactions.
              </CardDescription>
            </div>
            <Button onClick={handleManualRefresh} variant="ghost" size="icon" className="text-muted-foreground cursor-pointer">
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border">
              {recentTransactions.length > 0 ? (
                <Table>
                  <TableBody>
                    {recentTransactions.map((txn) => (
                      <TableRow key={txn.id} className="border-border hover:bg-secondary/30">
                        <TableCell className="font-semibold text-foreground">
                          @{txn.target}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {txn.date}
                        </TableCell>
                        <TableCell className="text-right">
                          {txn.type === 'deposit' ? (
                            <span className="inline-flex items-center text-success-text font-mono font-bold">
                              +{formatCurrency(txn.amount)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-danger-text font-mono font-bold">
                              -{formatCurrency(txn.amount)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <span className="inline-flex items-center rounded-full bg-secondary/50 px-2 py-0.5 text-muted-foreground font-semibold">
                            <Check className="mr-1 h-3 w-3 text-success-text" /> Success
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-12 text-center text-xs text-muted-foreground font-medium">
                  No point transfers recorded yet.
                </div>
              )}
            </div>
            <div className="mt-4 text-center">
              <a href="/agent/history" className="text-sm font-semibold text-primary hover:underline">
                View all transactions &rarr;
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
