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
import { Card, CardContent } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Eye, EyeOff, Loader2, Search, Users, ShieldCheck, ArrowRight, User } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { createAgentAction, getAgentsAction } from './actions'

export default function AgentsPage() {
  const [agents, setAgents] = React.useState<Array<{ id: string; name: string; username: string; balance: number; status: string }>>([])
  const [isLoadingAgents, setIsLoadingAgents] = React.useState(true)
  const [currentPage, setCurrentPage] = React.useState(1)
  const [searchQuery, setSearchQuery] = React.useState('')
  
  // Create Agent modal state
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)

  const itemsPerPage = 10

  const loadAgents = React.useCallback(() => {
    setIsLoadingAgents(true)
    getAgentsAction().then((res) => {
      setIsLoadingAgents(false)
      if (res.agents) {
        setAgents(res.agents)
      }
    }).catch(() => setIsLoadingAgents(false))
  }, [])

  React.useEffect(() => {
    loadAgents()
  }, [loadAgents])

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

  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.username.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalPages = Math.ceil(filteredAgents.length / itemsPerPage) || 1
  const paginatedAgents = filteredAgents.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 md:px-0 pb-12">
      {/* Top Title & Add Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Users className="h-5 w-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
              Agent Directory
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-primary/10 text-primary border border-primary/20">
              {agents.length} Total
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
            Manage your agent network, issue cashier points, and monitor real-time activity.
          </p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger className={buttonVariants({ variant: "default", size: "lg", className: "w-full sm:w-auto h-11 px-5 font-extrabold shadow-lg shadow-primary/20 cursor-pointer rounded-xl text-sm" })}>
            <Plus className="mr-2 h-4 w-4 stroke-[3]" /> Add New Agent
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-card border-border/80 text-foreground shadow-2xl rounded-2xl p-6">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-xl font-black">Register New Agent</DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs">
                Create a new agent back-office account. They will need these credentials to sign in.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateAgent} className="space-y-4 pt-2">
              {errorMessage && (
                <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20 flex items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-2 shrink-0 animate-ping" />
                  {errorMessage}
                </div>
              )}
              {successMessage && (
                <div className="p-3 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20">
                  {successMessage}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Full Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g. John Doe"
                  className="h-11 bg-background/60 border-border text-foreground text-sm rounded-lg"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Username
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-sm text-muted-foreground/70 font-mono">@</span>
                  <Input
                    id="username"
                    name="username"
                    placeholder="agent_john"
                    className="pl-8 h-11 bg-background/60 border-border text-foreground text-sm rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className="h-11 bg-background/60 border-border text-foreground pr-10 text-sm rounded-lg"
                    required
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

              <DialogFooter className="pt-2">
                <Button type="submit" disabled={isLoading} className="w-full h-11 font-extrabold text-sm rounded-lg shadow-md shadow-primary/10 cursor-pointer">
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isLoading ? 'Registering Agent...' : 'Create Agent Account'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex border-b border-border/60 space-x-2">
        <Link
          href="/superadmin/agents"
          className="py-2.5 px-4 font-extrabold text-sm text-primary border-b-2 border-primary flex items-center space-x-2"
        >
          <ShieldCheck className="h-4 w-4" />
          <span>Agent Directory</span>
        </Link>
        <Link
          href="/superadmin/agents/issued"
          className="py-2.5 px-4 font-semibold text-sm text-muted-foreground hover:text-foreground border-b-2 border-transparent hover:border-border transition-all flex items-center space-x-2"
        >
          <span>Coins Issued Ledger</span>
        </Link>
      </div>

      {/* Search Input Bar */}
      <div className="relative max-w-md w-full">
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground/70" />
        <Input 
          placeholder="Search agents by name or @username..." 
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setCurrentPage(1)
          }}
          className="pl-10 h-11 bg-card border-border/80 text-foreground text-sm rounded-xl focus:border-primary/50 shadow-xs" 
        />
        {searchQuery && (
          <button 
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-3 text-xs text-muted-foreground hover:text-foreground font-bold"
          >
            Clear
          </button>
        )}
      </div>

      {/* --- DESKTOP VIEW (hidden on mobile, visible md+) --- */}
      <div className="hidden md:block rounded-2xl border border-border/80 bg-card overflow-hidden shadow-xl">
        <div className="overflow-x-auto table-scroll">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] min-w-[160px]">Agent Name</TableHead>
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider min-w-[130px]">Username</TableHead>
                <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[130px]">Coins Balance</TableHead>
                <TableHead className="text-center text-muted-foreground text-xs uppercase tracking-wider min-w-[110px]">Status</TableHead>
                <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider min-w-[130px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingAgents ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell className="sticky left-0 bg-card z-10">
                      <div className="h-5 bg-secondary/80 rounded-md animate-pulse w-32" />
                    </TableCell>
                    <TableCell><div className="h-4 bg-secondary/60 rounded-md animate-pulse w-24" /></TableCell>
                    <TableCell className="text-right"><div className="h-5 bg-secondary/70 rounded-md animate-pulse w-20 ml-auto" /></TableCell>
                    <TableCell className="text-center"><div className="h-5 bg-secondary/80 rounded-full animate-pulse w-16 mx-auto" /></TableCell>
                    <TableCell className="text-right"><div className="h-8 bg-secondary/60 rounded-lg animate-pulse w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : paginatedAgents.length > 0 ? (
                paginatedAgents.map((agent) => (
                  <TableRow key={agent.id} className="border-border hover:bg-secondary/40 transition-colors">
                    <TableCell className="font-bold text-foreground text-sm sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                      <Link href={`/superadmin/agents/${agent.id}`} className="hover:text-primary transition-colors flex items-center space-x-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 text-xs font-black">
                          {agent.name[0]?.toUpperCase()}
                        </div>
                        <span>{agent.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">@{agent.username}</TableCell>
                    <TableCell className="text-right text-foreground font-mono font-black text-sm">
                      {formatCurrency(agent.balance)}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-black ${
                        agent.status === 'Active' 
                          ? 'bg-success-bg text-success-text border border-emerald-500/20' 
                          : 'bg-danger-bg text-danger-text border border-red-500/20'
                      }`}>
                        {agent.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right space-x-2 whitespace-nowrap">
                      <Link
                        href={`/superadmin/agents/${agent.id}`}
                        className={buttonVariants({ variant: "outline", size: "sm", className: "border-primary/30 text-primary hover:bg-primary/10 cursor-pointer font-bold rounded-lg text-xs" })}
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" /> View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-36 text-center text-muted-foreground text-xs font-medium">
                    No agents found matching &quot;{searchQuery}&quot;.
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

      {/* --- MOBILE VIEW CARDS (visible on mobile < md, hidden on md+) --- */}
      <div className="md:hidden space-y-3">
        {isLoadingAgents ? (
          [1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-border/80 bg-card p-4 rounded-xl space-y-3 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-5 bg-secondary/80 rounded w-1/3" />
                <div className="h-5 bg-secondary/60 rounded-full w-16" />
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="h-4 bg-secondary/60 rounded w-1/4" />
                <div className="h-6 bg-secondary/80 rounded w-24" />
              </div>
              <div className="h-10 bg-secondary/50 rounded-lg w-full pt-2" />
            </Card>
          ))
        ) : paginatedAgents.length > 0 ? (
          paginatedAgents.map((agent) => (
            <Card key={agent.id} className="border-border/80 bg-card/90 backdrop-blur-xs p-4 rounded-2xl space-y-3 shadow-md relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-sm shrink-0">
                    {agent.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-extrabold text-foreground text-sm leading-tight">{agent.name}</h3>
                    <p className="text-muted-foreground font-mono text-xs">@{agent.username}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black ${
                  agent.status === 'Active' 
                    ? 'bg-success-bg text-success-text border border-emerald-500/20' 
                    : 'bg-danger-bg text-danger-text border border-red-500/20'
                }`}>
                  {agent.status}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs">
                <span className="text-muted-foreground font-semibold">Coins Balance</span>
                <span className="font-mono font-black text-foreground text-base">{formatCurrency(agent.balance)}</span>
              </div>

              <Link
                href={`/superadmin/agents/${agent.id}`}
                className={buttonVariants({ variant: "outline", size: "sm", className: "w-full h-10 border-primary/30 text-primary hover:bg-primary/10 font-bold justify-center rounded-xl text-xs" })}
              >
                <span>View Agent Dashboard</span>
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Card>
          ))
        ) : (
          <div className="p-8 text-center text-muted-foreground text-xs font-medium bg-card rounded-2xl border border-border">
            No agents found.
          </div>
        )}

        {filteredAgents.length > itemsPerPage && (
          <div className="pt-2">
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
