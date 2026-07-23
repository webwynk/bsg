"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { createPlayerAction, getPlayersAction } from './actions'

export default function PlayersPage() {
  const [players, setPlayers] = React.useState<Array<{ id: string; name: string; username: string; balance: number; status: string; gamePlays: number }>>([])
  const [selectedPlayer, setSelectedPlayer] = React.useState<typeof players[0] | null>(null)
  const [activeTab, setActiveTab] = React.useState<'games' | 'points'>('games')

  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)

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

  const handleCreatePlayer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const username = formData.get('username') as string

    const res = await createPlayerAction(formData)

    setIsLoading(false)
    if (res.error) {
      setErrorMessage(res.error)
    } else {
      setSuccessMessage(`Player "@${username}" created successfully!`)
      setPlayers((prev) => [
        {
          id: res.user?.id || Date.now().toString(),
          name,
          username,
          balance: 0,
          status: 'Active',
          gamePlays: 0,
        },
        ...prev,
      ])
      setTimeout(() => {
        setIsOpen(false)
        setSuccessMessage(null)
      }, 1200)
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Player Management</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Register players, block/unblock accounts, and transfer points.
          </p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger className={buttonVariants({ variant: "default" })}>
            <Plus className="mr-2 h-4 w-4" /> Create Player
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-card border-border text-foreground">
            <DialogHeader>
              <DialogTitle>Register New Player</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Enter details to provision a new player account.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreatePlayer}>
              <div className="grid gap-4 py-4">
                {errorMessage && (
                  <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                    {errorMessage}
                  </div>
                )}
                {successMessage && (
                  <div className="p-3 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20">
                    {successMessage}
                  </div>
                )}

                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right text-muted-foreground">Name</Label>
                  <Input id="name" name="name" placeholder="Rahul S." className="col-span-3 bg-background border-border text-foreground" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="username" className="text-right text-muted-foreground">Username</Label>
                  <Input id="username" name="username" placeholder="rahul99" className="col-span-3 bg-background border-border text-foreground" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="password" className="text-right text-muted-foreground">Password</Label>
                  <Input id="password" name="password" type="password" className="col-span-3 bg-background border-border text-foreground" required />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isLoading} className="w-full font-bold cursor-pointer">
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isLoading ? 'Creating Player...' : 'Create Player'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-12">
        {/* Left Bento: Players Directory List */}
        <Card className="lg:col-span-5 bg-card border-border shadow-sm rounded-xl overflow-hidden flex flex-col h-[580px]">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-lg font-bold text-foreground">Registered Players</CardTitle>
            <CardDescription className="text-muted-foreground">
              Click a player to view details or perform balance operations.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto flex-1">
            {players.length > 0 ? (
              <div className="divide-y divide-border/60">
                {players.map((player) => (
                  <div
                    key={player.id}
                    onClick={() => setSelectedPlayer(player)}
                    className={`p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-secondary/40 transition-colors ${
                      selectedPlayer?.id === player.id ? 'bg-secondary/80 border-l-4 border-primary' : ''
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="font-bold text-sm text-foreground truncate">{player.name}</p>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${player.status === 'Active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      </div>
                      <span className="text-xs text-muted-foreground">@{player.username}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm font-mono">{formatCurrency(player.balance)}</p>
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                        {player.gamePlays} plays
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground text-xs font-medium">
                No players created yet. Click &quot;Create Player&quot; to provision a game account.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Bento: Selected Player Details */}
        <Card className="lg:col-span-7 bg-card border-border shadow-sm rounded-xl overflow-hidden flex flex-col h-[580px]">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="text-lg font-bold text-foreground">
                  {selectedPlayer ? `History of ${selectedPlayer.name}` : 'Player History'}
                </CardTitle>
                <CardDescription className="text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  {selectedPlayer ? `@${selectedPlayer.username} • Balance: ${formatCurrency(selectedPlayer.balance)}` : 'Select a player from the directory'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          {/* Navigation Tabs */}
          <div className="flex border-b border-border/60 bg-secondary/30">
            <button
              onClick={() => setActiveTab('games')}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all ${
                activeTab === 'games' ? 'border-primary text-foreground bg-secondary/50' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Game Plays (0)
            </button>
            <button
              onClick={() => setActiveTab('points')}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all ${
                activeTab === 'points' ? 'border-primary text-foreground bg-secondary/50' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Points History (0)
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col justify-center items-center bg-card text-foreground p-8 text-center text-xs text-muted-foreground">
            {selectedPlayer ? 'No activity recorded yet for this player.' : 'Select a player to view full history and audit logs.'}
          </div>
        </Card>
      </div>
    </div>
  )
}
