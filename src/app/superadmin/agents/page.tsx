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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, ArrowUpRight, ArrowDownRight } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ResponsivePagination } from "@/components/responsive-pagination"

export default function AgentsPage() {
  const [agents, setAgents] = React.useState<Array<{ id: string; name: string; username: string; balance: number; status: string }>>([])
  const [currentPage, setCurrentPage] = React.useState(1)
  const [searchQuery, setSearchQuery] = React.useState('')
  const itemsPerPage = 10

  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.username.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalPages = Math.ceil(filteredAgents.length / itemsPerPage) || 1
  const paginatedAgents = filteredAgents.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Agents</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your agent network, transfer points, and monitor activity.
          </p>
        </div>

        <Dialog>
          <DialogTrigger className={buttonVariants({ variant: "default" })}>
            <Plus className="mr-2 h-4 w-4" /> Add Agent
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-card border-border text-foreground">
            <DialogHeader>
              <DialogTitle>Create New Agent</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Create a new agent account. They will need these credentials to log in.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right text-muted-foreground">
                  Name
                </Label>
                <Input id="name" placeholder="John Doe" className="col-span-3 bg-background border-border text-foreground" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="username" className="text-right text-muted-foreground">
                  Username
                </Label>
                <Input id="username" placeholder="agent_john" className="col-span-3 bg-background border-border text-foreground" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="password" className="text-right text-muted-foreground">
                  Password
                </Label>
                <Input id="password" type="password" className="col-span-3 bg-background border-border text-foreground" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full">Create Agent</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center justify-between mb-4">
        <Input 
          placeholder="Search agents..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm bg-card border-border text-foreground" 
        />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto table-scroll">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] min-w-[150px]">Name</TableHead>
                <TableHead className="text-muted-foreground min-w-[120px]">Username</TableHead>
                <TableHead className="text-right text-muted-foreground min-w-[120px]">Balance</TableHead>
                <TableHead className="text-center text-muted-foreground min-w-[100px]">Status</TableHead>
                <TableHead className="text-right text-muted-foreground min-w-[200px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedAgents.length > 0 ? (
                paginatedAgents.map((agent) => (
                  <TableRow key={agent.id} className="border-border hover:bg-secondary/50">
                    <TableCell className="font-semibold text-foreground sticky left-0 bg-card z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                      <a href={`/superadmin/agents/${agent.id}`} className="hover:underline font-bold text-primary">
                        {agent.name}
                      </a>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{agent.username}</TableCell>
                    <TableCell className="text-right text-foreground font-mono font-bold">
                      {formatCurrency(agent.balance)}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        agent.status === 'Active' 
                          ? 'bg-success-bg text-success-text' 
                          : 'bg-danger-bg text-danger-text'
                      }`}>
                        {agent.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right space-x-2 whitespace-nowrap">
                      <Dialog>
                        <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer" })}>
                          <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> Deposit
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
                          <DialogHeader>
                            <DialogTitle>Issue Points to Agent</DialogTitle>
                            <DialogDescription className="text-muted-foreground">
                              Add points to {agent.name}'s balance.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Current Balance:</span>
                              <span className="font-bold text-success-text">{formatCurrency(agent.balance)}</span>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="amount">Amount (INR)</Label>
                              <Input id="amount" type="number" placeholder="50000" className="bg-background border-border text-foreground text-lg" />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button className="w-full bg-success text-white hover:bg-success/90">Confirm Deposit</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      <Dialog>
                        <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm", className: "border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer" })}>
                          <ArrowDownRight className="mr-1 h-3.5 w-3.5" /> Withdraw
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground">
                          <DialogHeader>
                            <DialogTitle>Withdraw Points from Agent</DialogTitle>
                            <DialogDescription className="text-muted-foreground">
                              Recall points from {agent.name}'s balance.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Current Balance:</span>
                              <span className="font-bold text-danger-text">{formatCurrency(agent.balance)}</span>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="amount">Amount (INR)</Label>
                              <Input id="amount" type="number" placeholder="50000" max={agent.balance / 100} className="bg-background border-border text-foreground text-lg" />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm Withdrawal</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground text-xs font-medium">
                    No agents created yet. Click "Add Agent" to register your first agent.
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
    </div>
  )
}
