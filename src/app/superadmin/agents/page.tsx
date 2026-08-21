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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Card } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { 
  Plus, Search, ShieldCheck, Eye, RefreshCw, Loader2, Coins, ArrowUpRight, 
  ArrowDownRight, Users, EyeOff, UserX, UserCheck, KeyRound, CheckCircle2, AlertCircle,
  Filter, ArrowRight
} from 'lucide-react'
import { formatCurrency } from "@/lib/utils"
import { USERNAME_PATTERN } from "@/lib/validation"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { ErrorBanner } from "@/components/error-banner"
import { createAgentAction, getAgentsAction } from './actions'
import { playerStatus } from '@/lib/player-status'

export default function AgentsPage() {
  const [agents, setAgents] = React.useState<Array<{ id: string; full_name: string; username: string; coin_balance: number; is_active: boolean; auto_locked_at: string | null; player_count: number }>>([])
  // Issue #15: distinct from errorMessage below, which is scoped to the
  // Create Agent modal -- this one is for the page's own data load.
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isLoadingAgents, setIsLoadingAgents] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [countdown, setCountdown] = React.useState(60)
  const [currentPage, setCurrentPage] = React.useState(1)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'Active' | 'Temporary Block' | 'Blocked'>('all')
  
  // Create Agent modal state
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)
  
  const [usernameInput, setUsernameInput] = React.useState('')
  const isUsernameTouched = usernameInput.length > 0
  const isUsernameValid = React.useMemo(() => USERNAME_PATTERN.test(usernameInput), [usernameInput])

  const itemsPerPage = 10

  const loadAgents = React.useCallback((isInitial: boolean = false) => {
    if (isInitial) setIsLoadingAgents(true)
    getAgentsAction().then((res) => {
      setIsLoadingAgents(false)
      setLoadError(res.error)
      if (!res.error) {
        setAgents(res.agents)
      }
    }).catch((e) => {
      setIsLoadingAgents(false)
      setLoadError(e instanceof Error ? e.message : 'Could not load agents.')
    })
  }, [])

  React.useEffect(() => {
    loadAgents(true)

    const countdownTick = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? 60 : prev - 1))
    }, 1000)

    const dataInterval = setInterval(() => {
      setCountdown(60)
      loadAgents(false)
    }, 60000)

    return () => {
      clearInterval(countdownTick)
      clearInterval(dataInterval)
    }
  }, [loadAgents])

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    setCountdown(60)
    loadAgents(false)
    setTimeout(() => setIsRefreshing(false), 600)
  }

  const handleCreateAgent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    const formData = new FormData(e.currentTarget)
    const username = formData.get('username') as string

    const res = await createAgentAction(formData)

    setIsLoading(false)
    if (res.error) {
      setErrorMessage(res.error)
    } else {
      setSuccessMessage(`Agent "@${username}" created successfully!`)
      loadAgents()
      setTimeout(() => {
        setIsOpen(false)
        setSuccessMessage(null)
      }, 1200)
    }
  }

  const filteredAgents = agents.filter(agent => {
    const matchesSearch = agent.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.username.toLowerCase().includes(searchQuery.toLowerCase())
    // Driven by the same playerStatus() the badge itself renders from -- not
    // a second, independent is_active check -- so the filter and the badge
    // can never silently disagree the way they did before this fix.
    const matchesStatus = statusFilter === 'all' || playerStatus(agent).label === statusFilter
    return matchesSearch && matchesStatus
  })

  const totalPages = Math.ceil(filteredAgents.length / itemsPerPage) || 1
  const paginatedAgents = filteredAgents.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const activeCount = agents.filter(a => a.is_active).length
  const totalCirculation = agents.reduce((acc, a) => acc + Number(a.coin_balance || 0), 0)

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      <ErrorBanner error={loadError} />

      {/* Top Title & Action Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-card border border-border/80 rounded-2xl shadow-xs">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground">
                Agent Directory
              </h1>
              {isLoadingAgents ? (
                <div className="h-5 w-14 bg-secondary/80 animate-pulse rounded-full" />
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-primary/10 text-primary border border-primary/20">
                  {agents.length} Total
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs leading-tight hidden sm:block">
              Manage your agent network, issue cashier points, and monitor real-time activity.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Auto-Sync ({countdown}s)
          </span>
          <Button onClick={handleManualRefresh} variant="outline" size="sm" className="flex-1 sm:flex-none h-8 sm:h-9 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border shrink-0">
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open)
            if (!open) {
              setUsernameInput('')
              setErrorMessage(null)
              setSuccessMessage(null)
            }
          }}>
            <DialogTrigger className={buttonVariants({ variant: "default", size: "sm", className: "flex-1 sm:flex-none h-8 sm:h-9 px-3 sm:px-4 font-extrabold shadow-sm cursor-pointer rounded-xl text-[11px] sm:text-xs" })}>
              <Plus className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Add Agent
            </DialogTrigger>
          <DialogContent className="sm:max-w-[430px] bg-card border-border/80 text-foreground shadow-2xl rounded-2xl p-0 overflow-hidden">
            <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-transparent p-5 border-b border-border/60">
              <div className="flex items-center space-x-2.5">
                <div className="p-2.5 rounded-xl bg-primary/20 text-primary border border-primary/30 shrink-0">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-black tracking-tight">Register New Agent</DialogTitle>
                  <DialogDescription className="text-muted-foreground text-xs mt-0.5">
                    Create a new agent back-office account with credentials.
                  </DialogDescription>
                </div>
              </div>
            </div>

            <form onSubmit={handleCreateAgent} className="p-5 space-y-4">
              {errorMessage && (
                <div className="p-3 text-xs font-bold rounded-xl bg-danger-bg text-danger-text border border-red-500/20 flex items-center shadow-xs">
                  <AlertCircle className="h-4 w-4 mr-2 text-red-500 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
              {successMessage && (
                <div className="p-3 text-xs font-bold rounded-xl bg-success-bg text-success-text border border-emerald-500/20 flex items-center shadow-xs">
                  <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500 shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Agent Full Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g. Rahul Sharma"
                  className="h-10 bg-background/70 border-border text-foreground text-xs rounded-xl focus:border-primary/50"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="username" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Username
                  </Label>
                  <span className="text-[10px] text-muted-foreground font-mono">Only letters & numbers</span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-muted-foreground/70 font-mono font-bold">@</span>
                  <Input
                    id="username"
                    name="username"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    placeholder="agent01"
                    className={`pl-8 pr-9 h-10 bg-background/70 text-foreground text-xs rounded-xl font-mono transition-all ${
                      isUsernameTouched
                        ? isUsernameValid
                          ? 'border-emerald-500/80 focus:border-emerald-500'
                          : 'border-red-500/80 focus:border-red-500'
                        : 'border-border focus:border-primary/50'
                    }`}
                    required
                  />
                  {isUsernameTouched && (
                    <div className="absolute right-3 top-2.5">
                      {isUsernameValid ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  )}
                </div>
                {isUsernameTouched && !isUsernameValid && (
                  <p className="text-[10px] font-bold text-red-500 flex items-center mt-1">
                    <AlertCircle className="h-3 w-3 mr-1 shrink-0" />
                    3-20 letters and numbers only (e.g. agent01, agent03)
                  </p>
                )}
                {isUsernameTouched && isUsernameValid && (
                  <p className="text-[10px] font-bold text-emerald-500 flex items-center mt-1">
                    <CheckCircle2 className="h-3 w-3 mr-1 shrink-0" />
                    Valid username format: @{usernameInput}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min 6 characters"
                    className="h-10 bg-background/70 border-border text-foreground pr-10 text-xs rounded-xl"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <DialogFooter className="pt-3">
                <Button 
                  type="submit" 
                  disabled={isLoading || (isUsernameTouched && !isUsernameValid)} 
                  className="w-full h-10 font-black text-xs rounded-xl shadow-md cursor-pointer bg-primary hover:bg-primary/90 transition-all"
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isLoading ? 'Registering Agent...' : 'Create Agent Account'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex border-b border-border/60 space-x-1">
        <Link
          href="/superadmin/agents"
          className="py-2 px-3 font-extrabold text-xs text-primary border-b-2 border-primary flex items-center space-x-1.5"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Agent Directory</span>
          <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-primary/20 text-primary">
            {agents.length}
          </span>
        </Link>
        <Link
          href="/superadmin/agents/issued"
          className="py-2 px-3 font-semibold text-xs text-muted-foreground hover:text-foreground border-b-2 border-transparent hover:border-border transition-all flex items-center space-x-1.5"
        >
          <Coins className="h-3.5 w-3.5" />
          <span>Coins Issued Ledger</span>
        </Link>
      </div>

      {/* Overview Metrics Strip (3 Compact Cards) */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
        <Card className="bg-card border-border/80 shadow-2xs p-2 sm:p-3 rounded-xl">
          <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground font-bold">
            <span>Total Agents</span>
            <Users className="h-3.5 w-3.5 text-primary shrink-0 hidden sm:block" />
          </div>
          {isLoadingAgents || isRefreshing ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-xs sm:text-lg font-black font-mono text-foreground mt-0.5">{agents.length}</div>
          )}
        </Card>

        {/* Housekeeping #32 fix: this card was missing -- the grid was
            already laid out for 3 cards (grid-cols-3, and the section
            comment above already said "3 Compact Cards"), but only 2 ever
            existed. activeCount was already being computed for exactly
            this purpose and sitting unused. */}
        <Card className="bg-card border-border/80 shadow-2xs p-2 sm:p-3 rounded-xl">
          <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground font-bold">
            <span>Active Agents</span>
            <UserCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0 hidden sm:block" />
          </div>
          {isLoadingAgents || isRefreshing ? (
            <div className="h-5 w-16 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-xs sm:text-lg font-black font-mono text-emerald-500 mt-0.5">{activeCount}</div>
          )}
        </Card>

        <Card className="bg-card border-border/80 shadow-2xs p-2 sm:p-3 rounded-xl">
          <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground font-bold">
            <span>Active Network</span>
            <Coins className="h-3.5 w-3.5 text-amber-500" />
          </div>
          {isLoadingAgents ? (
            <div className="h-5 w-20 bg-secondary/80 animate-pulse rounded my-1" />
          ) : (
            <div className="text-lg font-black font-mono text-amber-500 mt-0.5">{formatCurrency(totalCirculation)}</div>
          )}
        </Card>
      </div>

      {/* Search & Status Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 bg-card p-2.5 border border-border/80 rounded-xl shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground/70" />
          <Input 
            placeholder="Search agents by name or @username..." 
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setCurrentPage(1)
            }}
            className="pl-8 h-8 bg-background border-border text-foreground text-xs rounded-lg focus:border-primary/50" 
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2 text-[11px] text-muted-foreground hover:text-foreground font-bold cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <div className="flex items-center space-x-1.5 text-xs text-muted-foreground font-semibold">
            <Filter className="h-3.5 w-3.5" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'all' | 'Active' | 'Temporary Block' | 'Blocked')
                setCurrentPage(1)
              }}
              className="h-8 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="Active">Active Only</option>
              <option value="Temporary Block">Temporary Block Only</option>
              <option value="Blocked">Blocked Only</option>
            </select>
          </div>

          {(searchQuery || statusFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('')
                setStatusFilter('all')
                setCurrentPage(1)
              }}
              className="h-8 px-2 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer font-bold"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* --- DESKTOP TABLE VIEW (hidden on mobile < sm, visible sm+) --- */}
      <div className="hidden sm:block rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs">
        <div className="overflow-x-auto table-scroll">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider sticky left-0 bg-card z-10 py-2.5">Agent Name</TableHead>
                <TableHead className="text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Username</TableHead>
                <TableHead className="text-right text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Coins Balance</TableHead>
                <TableHead className="text-center text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Status</TableHead>
                <TableHead className="text-right text-muted-foreground text-[11px] uppercase tracking-wider py-2.5">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingAgents ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell className="sticky left-0 bg-card z-10 py-2.5">
                      <div className="h-4 bg-secondary/80 rounded-md animate-pulse w-32" />
                    </TableCell>
                    <TableCell className="py-2.5"><div className="h-4 bg-secondary/60 rounded-md animate-pulse w-24" /></TableCell>
                    <TableCell className="text-right py-2.5"><div className="h-4 bg-secondary/70 rounded-md animate-pulse w-20 ml-auto" /></TableCell>
                    <TableCell className="text-center py-2.5"><div className="h-4 bg-secondary/80 rounded-full animate-pulse w-16 mx-auto" /></TableCell>
                    <TableCell className="text-right py-2.5"><div className="h-7 bg-secondary/60 rounded-lg animate-pulse w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : paginatedAgents.length > 0 ? (
                paginatedAgents.map((agent) => (
                  <TableRow key={agent.id} className="border-border hover:bg-secondary/30 transition-colors">
                    <TableCell className="font-bold text-foreground text-xs sticky left-0 bg-card z-10 py-2">
                      <Link href={`/superadmin/agents/${agent.username}`} className="hover:text-primary transition-colors flex items-center space-x-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 text-xs font-black">
                          {agent.full_name[0]?.toUpperCase()}
                        </div>
                        <span>{agent.full_name}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs py-2">@{agent.username}</TableCell>
                    <TableCell className="text-right text-foreground font-mono font-black text-xs py-2">
                      {formatCurrency(agent.coin_balance)}
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black ${playerStatus(agent).badgeClass}`}>
                        {playerStatus(agent).label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap py-2">
                      <Link
                        href={`/superadmin/agents/${agent.username}`}
                        className={buttonVariants({ variant: "outline", size: "sm", className: "h-7 px-2.5 border-primary/30 text-primary hover:bg-primary/10 cursor-pointer font-bold rounded-lg text-xs" })}
                      >
                        <Eye className="mr-1 h-3 w-3" /> View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-muted-foreground text-xs font-medium">
                    No agents found matching current filter criteria.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {filteredAgents.length > itemsPerPage && (
          <ResponsivePagination 
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={filteredAgents.length}
            itemsPerPage={itemsPerPage}
          />
        )}
      </div>

      {/* --- MOBILE VIEW CARDS (visible on mobile < sm, hidden on sm+) --- */}
      <div className="sm:hidden space-y-2.5">
        {isLoadingAgents ? (
          [1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-border/80 bg-card p-3 rounded-xl space-y-2.5 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-4 bg-secondary/80 rounded w-1/3" />
                <div className="h-4 bg-secondary/60 rounded-full w-14" />
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="h-3 bg-secondary/60 rounded w-1/4" />
                <div className="h-5 bg-secondary/80 rounded w-20" />
              </div>
              <div className="h-8 bg-secondary/50 rounded-lg w-full" />
            </Card>
          ))
        ) : paginatedAgents.length > 0 ? (
          paginatedAgents.map((agent) => (
            <Card key={agent.id} className="border-border/80 bg-card p-3 rounded-xl space-y-2.5 shadow-2xs relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-xs shrink-0">
                    {agent.full_name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-extrabold text-foreground text-xs leading-tight">{agent.full_name}</h3>
                    <p className="text-muted-foreground font-mono text-[11px]">@{agent.username}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black ${playerStatus(agent).badgeClass}`}>
                  {playerStatus(agent).label}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs">
                <span className="text-muted-foreground font-semibold text-[11px]">Coins Balance</span>
                <span className="font-mono font-black text-foreground text-sm">{formatCurrency(agent.coin_balance)}</span>
              </div>

              <Link
                href={`/superadmin/agents/${agent.username}`}
                className={buttonVariants({ variant: "outline", size: "sm", className: "w-full h-8 border-primary/30 text-primary hover:bg-primary/10 font-bold justify-center rounded-lg text-xs" })}
              >
                <span>View Agent Dashboard</span>
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Card>
          ))
        ) : (
          <div className="p-6 text-center text-muted-foreground text-xs font-medium bg-card rounded-xl border border-border">
            No agents found.
          </div>
        )}

        {filteredAgents.length > itemsPerPage && (
          <div className="pt-1">
            <ResponsivePagination 
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              totalItems={filteredAgents.length}
              itemsPerPage={itemsPerPage}
            />
          </div>
        )}
      </div>
    </div>
  )
}
