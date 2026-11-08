"use client"

import { accountCodeLabel, accountCodeMatches } from '@/lib/account-codes'
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useParams } from 'next/navigation'
import {
  Plus, Loader2, ArrowUpRight, ArrowDownRight, UserX, UserCheck, KeyRound,
  ArrowLeft, Eye, EyeOff, Search, Users, Gamepad2, Coins,
  Calendar as CalendarIcon, RefreshCw, X,
  CheckCircle2, AlertCircle, Lock
} from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { USERNAME_PATTERN } from "@/lib/validation"
import { pickedDayKey } from "@/lib/date-range"
import { playerStatus } from "@/lib/player-status"
import { ResponsivePagination } from "@/components/responsive-pagination"
import { ErrorBanner } from "@/components/error-banner"
import { ResetPasswordDialog } from "@/components/reset-password-dialog"
import { PlayerGameHistory } from "@/components/player-game-history"
import { useLiveSync } from "@/hooks/use-live-sync"
import { LiveSyncBadge } from "@/components/live-sync-badge"
import { useRequestGeneration } from "@/hooks/use-request-generation"
import type { PlayerCoinMovement, PlayerRow } from '@/app/agent/players/actions'
import { createPlayerAction, getPlayersWithHistoryAction, setPlayerActiveAction, getPlayerDetailHistoryAction, transferPlayerCoinsAction } from '@/app/agent/players/actions'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function PlayersPage() {
  const [players, setPlayers] = React.useState<PlayerRow[]>([])
  const [selectedPlayer, setSelectedPlayer] = React.useState<typeof players[0] | null>(null)
  const [activeTab, setActiveTab] = React.useState<'games' | 'points'>('games')
  // Which game's plays the Game Plays tab shows (spec 13.2, 17AT).
  const [searchQuery, setSearchQuery] = React.useState('')
  const [isLoadingPlayers, setIsLoadingPlayers] = React.useState(true)
  const params = useParams()
  const urlSlug = Array.isArray(params?.slug) ? params.slug[0] : (params?.slug || '')

  const [usernameInput, setUsernameInput] = React.useState('')
  const isUsernameTouched = usernameInput.length > 0
  const isUsernameValid = React.useMemo(() => USERNAME_PATTERN.test(usernameInput), [usernameInput])

  // Mobile layout state: show list or details pane
  const [showMobileDetail, setShowMobileDetail] = React.useState(false)

  // History data states

  const [pointsHistory, setPointsHistory] = React.useState<PlayerCoinMovement[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false)

  // Filter states
  // Issue #90 fix: filterDate is a plain IST day key ("2026-08-15"), not a
  // Date object. Both places that can set it -- the Calendar picker (via
  // pickedDayKey, a local-frame read with no timezone conversion) and the
  // "Today" quick-button (via toLocaleDateString(...,{timeZone:'Asia/Kolkata'}),
  // a genuine instant that DOES need timezone-aware conversion) -- resolve to
  // the same kind of trusted value at the point each one is set, so nothing
  // downstream can accidentally apply the wrong conversion to the wrong kind
  // of origin the way a shared Date + single downstream conversion could.
  const [filterDate, setFilterDate] = React.useState<string | undefined>(undefined)

  // Pagination states
  const [pointsPage, setPointsPage] = React.useState(1)
  const itemsPerPage = 5
  // Housekeeping #87 fix: tracks the last-seen filter values so pagination
  // can be corrected during render itself -- React's own recommended
  // pattern for "adjust state when a dependency changes" -- instead of an
  // effect, which draws one wrong frame before fixing itself a render later.
  const [lastFilters, setLastFilters] = React.useState<[string | undefined]>([filterDate])

  // Reset pagination when filters change -- corrected during render (see
  // lastFilters above), not in an effect.
  if (lastFilters[0] !== filterDate) {
    setLastFilters([filterDate])
    setPointsPage(1)
  }

  // Filtered points history list — uses ISO date comparison for accuracy across midnight boundaries
  const filteredPoints = React.useMemo(() => {
    return pointsHistory.filter(tx => {
      // Issue #90 fix: filterDate is already the resolved IST day key.
      if (filterDate) {
        const txDateStr = tx.created_at_iso
          ? new Date(tx.created_at_iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
          : tx.created_at
        if (txDateStr !== filterDate) return false
      }
      return true
    })
  }, [pointsHistory, filterDate])

  const paginatedPoints = React.useMemo(() => {
    const start = (pointsPage - 1) * itemsPerPage
    return filteredPoints.slice(start, start + itemsPerPage)
  }, [filteredPoints, pointsPage])

  // Create Player modal state
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)

  // Point transfer state
  const [activeTransferModal, setActiveTransferModal] = React.useState<'deposit' | 'withdraw' | null>(null)
  const [transferAmount, setTransferAmount] = React.useState('')
  const [isTransferring, setIsTransferring] = React.useState(false)
  const [transferError, setTransferError] = React.useState<string | null>(null)
  const [transferSuccess, setTransferSuccess] = React.useState<string | null>(null)

  // Status toggle state
  const [isTogglingStatus, setIsTogglingStatus] = React.useState(false)
  const [toggleStatusError, setToggleStatusError] = React.useState<string | null>(null)

  const [showCreatePassword, setShowCreatePassword] = React.useState(false)
  // Issue #15: for the page's own data load (loadPlayers/loadPlayerHistory)
  // -- distinct from errorMessage/transferError/toggleStatusError above,
  // which are each scoped to their own specific mutation.
  const [loadError, setLoadError] = React.useState<string | null>(null)

  // Tracks which player's history is currently loaded on screen. Reset
  // (page 1 + loading skeleton) only fires when this call is for a
  // *different* player than what's already loaded -- a genuine switch, not a
  // background refresh of the same player's data. Previously reset
  // unconditionally on every call, including the silent live-sync refresh
  // and the manual refresh button, which meant an agent reading page 3 of a
  // player's bet history got silently kicked back to page 1 on every refresh
  // even though nothing about which player was selected had changed.
  const loadedHistoryPlayerIdRef = React.useRef<string | null>(null)
  // Guards against an older, slower response overwriting a newer one -- e.g.
  // clicking between two players quickly enough that the first player's
  // request is still in flight when the second one starts; without this, a
  // stale response could win the race and show the wrong player's history.
  const historyRequest = useRequestGeneration()

  // Issue #93: extracted out of loadPlayerHistory so the SAME apply logic
  // (loadedHistoryPlayerIdRef bookkeeping, no pagination/skeleton reset for a
  // same-player background refresh) also covers history that arrives bundled
  // inside loadPlayers's getPlayersWithHistoryAction response, not just
  // history fetched by loadPlayerHistory's own standalone call.
  const applyHistoryResult = React.useCallback((playerId: string, res: {
    coin_movements: PlayerCoinMovement[]
    error: string | null
  }) => {
    loadedHistoryPlayerIdRef.current = playerId
    setIsLoadingHistory(false)
    setLoadError(res.error)
    if (!res.error) {
      setPointsHistory(res.coin_movements)
    }
  }, [])

  const loadPlayerHistory = React.useCallback((playerId: string) => {
    const isSwitchingPlayer = loadedHistoryPlayerIdRef.current !== playerId
    if (isSwitchingPlayer) {
      setIsLoadingHistory(true)
      setPointsPage(1)
    }
    const token = historyRequest.nextGeneration()
    getPlayerDetailHistoryAction(playerId).then((res) => {
      if (!historyRequest.isCurrent(token)) return
      applyHistoryResult(playerId, res)
    }).catch((e) => {
      if (!historyRequest.isCurrent(token)) return
      setIsLoadingHistory(false)
      setLoadError(e instanceof Error ? e.message : 'Could not load player history.')
    })
  }, [historyRequest, applyHistoryResult])

  const [isRefreshing, setIsRefreshing] = React.useState(false)
  // Same guard for the player-list fetch -- can be triggered by a live
  // event, the fallback timer, or a manual click, all independently.
  const playersRequest = useRequestGeneration()
  // Stable ref — tracks selected player ID without being a useCallback dependency
  const selectedPlayerIdRef = React.useRef<string | null>(null)

  // Housekeeping #87 fix: no longer takes a "show the refresh spinner" flag
  // -- that branch was genuinely live (unlike the equivalent finding on
  // other pages), so removing it isn't a no-op: it moves the decision of
  // whether to show the spinner out to each caller instead. Per user
  // decision, the mount effect below no longer shows the spinner (matching
  // every other page's initial-load behavior) -- the 6 other call sites all
  // explicitly set it themselves now, preserving their exact prior behavior.
  //
  // Issue #93: player list + the CURRENTLY selected player's history now
  // come back from ONE combined action/requireAuth() call instead of two,
  // for the steady-state case where a player is already selected. The
  // first-load URL-slug match and the no-selection-yet auto-select-first
  // case both still need their own follow-up loadPlayerHistory call below --
  // which player that ends up being isn't known until this response
  // arrives, so it can't be requested up front in the same round trip.
  const loadPlayers = React.useCallback((opts?: { reloadHistory?: boolean }) => {
    const reloadHistory = opts?.reloadHistory ?? false
    const token = playersRequest.nextGeneration()
    // Read once, up front, ONLY to decide what to ask the server for --
    // reconciling the response below uses a FRESH read of the ref instead of
    // this value (see bug note there).
    const requestedPlayerId = selectedPlayerIdRef.current
    const historyTargetId = (reloadHistory && requestedPlayerId) ? requestedPlayerId : undefined

    // Returned (not fire-and-forget) so useLiveSync can await it and skip
    // starting an overlapping poll tick while this one is still in flight --
    // see the in-flight guard added to use-live-sync.ts for why that matters
    // for this page specifically.
    return getPlayersWithHistoryAction(undefined, historyTargetId).then((res) => {
      if (!playersRequest.isCurrent(token)) return
      setIsRefreshing(false)
      setIsLoadingPlayers(false)
      setLoadError(res.error)
      if (!res.error) {
        setPlayers(res.players)
        // If URL has a username slug (e.g. /agent/players/player01), select that player
        if (urlSlug) {
          const matchBySlug = res.players.find(p => p.username.toLowerCase() === urlSlug.toLowerCase())
          if (matchBySlug) {
            selectedPlayerIdRef.current = matchBySlug.id
            setSelectedPlayer(matchBySlug)
            if (reloadHistory) loadPlayerHistory(matchBySlug.id)
            return
          }
        }
        // Issue #93 bug fix: this used to reuse the `targetId` captured
        // BEFORE the request was sent, which goes stale if the user clicks a
        // different player while this response is still in flight -- that
        // stale value would then silently revert the selection back to
        // whichever player was selected when this request was ISSUED, not
        // whichever one is actually selected now. Re-reading the ref fresh,
        // here, matches the page's pre-Issue-93 behavior.
        const currentlySelectedId = selectedPlayerIdRef.current
        if (currentlySelectedId) {
          const updated = res.players.find(p => p.id === currentlySelectedId)
          if (updated) {
            setSelectedPlayer(updated)
            // Only apply this response's history if it was actually fetched
            // for the player still selected right now -- see the identical
            // fix and full explanation on
            // superadmin/agents/[agentUsername]/page.tsx's loadAgentDetails.
            // Deliberately NOT gated behind a shared generation counter with
            // loadPlayerHistory here (an earlier version of this fix was):
            // under real production latency this page's own requests
            // sometimes run close to or past the 3s poll interval, and a
            // counter bumped by every single poll tick regardless of
            // relevance meant a response could permanently never catch up to
            // "current", leaving the history skeleton stuck loading forever
            // -- confirmed live. playersRequest's check above already
            // discards a genuinely out-of-order/stale response; this only
            // needs to confirm the player still matches.
            if (historyTargetId && historyTargetId === currentlySelectedId) {
              applyHistoryResult(currentlySelectedId, res.history)
            }
          }
        } else if (res.players.length > 0) {
          selectedPlayerIdRef.current = res.players[0].id
          setSelectedPlayer(res.players[0])
          loadPlayerHistory(res.players[0].id)
        }
      }
    }).catch((e) => {
      if (!playersRequest.isCurrent(token)) return
      setIsRefreshing(false)
      setIsLoadingPlayers(false)
      setLoadError(e instanceof Error ? e.message : 'Could not load players.')
    })
  }, [loadPlayerHistory, applyHistoryResult, urlSlug, playersRequest])

  // Issue #91 addendum (2026-08-25): replaces the old direct useLiveVersion
  // effect (mirrors the same fix on superadmin/agents/[agentUsername], the
  // superadmin-portal equivalent of this page). useLiveSync keeps the same
  // Realtime-driven fast path (the shared connection from LiveDataProvider,
  // mounted once in agent/layout.tsx -- still usually well under a second
  // when Realtime is actually delivering) but adds a guaranteed 3s poll
  // backstop instead of the old 90s one. Realtime's own "SUBSCRIBED"/
  // connected status was proven able to stay true for an entire session
  // while every event silently failed a server-side authorization check,
  // with zero client-visible signal -- see MASTER_AUDIT_AND_REMEDIATION_PLAN.md
  // Issue #91 for the full evidence. Tier 'fast' (3s) since this page shows
  // live gameplay outcomes for this agent's own players. No separate
  // mount-only effect is needed -- useLiveSync fires once on mount too.
  const { lastSyncedAt, tierMs, refresh } = useLiveSync(
    ['profiles', 'bets', 'coin_ledger'],
    () => loadPlayers({ reloadHistory: true }),
    'fast'
  )

  // Issue #93 bug fix: calls useLiveSync's own guarded refresh() instead of
  // loadPlayers directly -- a direct call bypassed the in-flight guard
  // entirely, letting a manual click still overlap with an already-in-flight
  // poll tick (confirmed live on the superadmin-portal equivalent of this
  // page: this alone was enough to leave the button stuck spinning for
  // 8-11s even after the poll itself stopped piling up).
  const handleManualRefresh = () => {
    setIsRefreshing(true)
    refresh()
  }

  const handleSelectPlayer = (player: typeof players[0]) => {
    if (selectedPlayer?.id === player.id) {
      setShowMobileDetail(true)
      return
    }
    selectedPlayerIdRef.current = player.id // keep ref in sync
    setSelectedPlayer(player)
    setShowMobileDetail(true)
    setToggleStatusError(null)
    setIsLoadingHistory(true)
    setPointsHistory([])
    setFilterDate(undefined)
    setPointsPage(1)
    loadPlayerHistory(player.id)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/agent/players/${player.username}`)
    }
  }

  const handleCreatePlayer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    const formData = new FormData(e.currentTarget)
    const username = formData.get('username') as string

    const res = await createPlayerAction(formData)

    setIsLoading(false)
    if (res.error) {
      setErrorMessage(res.error)
    } else {
      setSuccessMessage(`Player "@${username}" registered successfully!`)
      setIsRefreshing(true)
      loadPlayers({ reloadHistory: true })
      setTimeout(() => {
        setIsOpen(false)
        setSuccessMessage(null)
      }, 1200)
    }
  }

  const handleTransferPoints = async (type: 'deposit' | 'withdraw') => {
    if (!selectedPlayer) return
    const amountNum = parseFloat(transferAmount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setTransferError('Please enter a valid coin amount greater than 0.')
      return
    }

    setIsTransferring(true)
    setTransferError(null)

    const res = await transferPlayerCoinsAction(selectedPlayer.id, amountNum, type === 'deposit' ? 'credit' : 'debit')

    setIsTransferring(false)
    if (res.error) {
      setTransferError(res.error)
    } else {
      setTransferSuccess(`Successfully ${type === 'deposit' ? 'deposited' : 'withdrawn'} ${formatCurrency(amountNum)} Coins for @${selectedPlayer.username}!`)
      setIsRefreshing(true)
      loadPlayers({ reloadHistory: true })
      setTimeout(() => {
        setActiveTransferModal(null)
        setTransferAmount('')
        setTransferSuccess(null)
      }, 1200)
    }
  }

  const handleToggleStatus = async () => {
    if (!selectedPlayer) return
    setIsTogglingStatus(true)
    setToggleStatusError(null)

    // B-1 FIX: pass the DESIRED end state. The old code computed a "next
    // status" string and the action then derived its own new value from it, so
    // the two inversions cancelled and both buttons were no-ops.
    const res = await setPlayerActiveAction(selectedPlayer.id, !selectedPlayer.is_active)

    setIsTogglingStatus(false)
    if (res.error) {
      // Reachable in practice only if the auto-lock guard fires -- the button
      // itself is hidden for that case (see playerStatus() below), but the
      // guard lives in the server action too, so surface it rather than fail
      // silently if it's ever hit some other way.
      setToggleStatusError(res.error)
    } else {
      setIsRefreshing(true)
      loadPlayers({ reloadHistory: true })
    }
  }

  const filteredPlayers = players.filter(p =>
    p.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    accountCodeMatches(p.account_code, searchQuery)
  )

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto px-2 sm:px-4 md:px-0 pb-12">
      <ErrorBanner error={loadError} />
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <div className="p-1 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Users className="h-4 w-4" />
            </div>
            <h1 className="text-lg sm:text-2xl font-black tracking-tight text-foreground">
              Player Accounts
            </h1>
            <span className="inline-flex items-center px-2 py-0.2 rounded-full text-[10px] font-extrabold bg-primary/10 text-primary border border-primary/20">
              {players.length} Total
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-[11px] sm:text-xs hidden sm:block">
            Manage player balances, reset passwords, track gameplay history and cashier points.
          </p>
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <LiveSyncBadge lastSyncedAt={lastSyncedAt} tierMs={tierMs} />
          <Button onClick={handleManualRefresh} disabled={isRefreshing} variant="outline" size="sm" className="h-8 sm:h-10 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border flex-1 sm:flex-none">
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          {/* Add Player Modal */}
          <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open)
            if (!open) {
              setUsernameInput('')
              setErrorMessage(null)
              setSuccessMessage(null)
            }
          }}>
            <DialogTrigger className="flex-1 sm:flex-none h-8 sm:h-10 px-3 sm:px-4 font-extrabold bg-primary text-primary-foreground hover:bg-primary/95 shadow-sm cursor-pointer rounded-xl text-[11px] sm:text-xs flex items-center justify-center transition-all duration-200">
              <Plus className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Add Player
            </DialogTrigger>
          <DialogContent className="sm:max-w-[430px] bg-card border-border/80 text-foreground shadow-2xl rounded-2xl p-0 overflow-hidden">
            <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-transparent p-5 border-b border-border/60">
              <div className="flex items-center space-x-2.5">
                <div className="p-2.5 rounded-xl bg-primary/20 text-primary border border-primary/30 shrink-0">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-black tracking-tight">Register New Player</DialogTitle>
                  <DialogDescription className="text-muted-foreground text-xs mt-0.5">
                    Create a new player account for your agent sub-network.
                  </DialogDescription>
                </div>
              </div>
            </div>

            <form onSubmit={handleCreatePlayer} className="p-5 space-y-4">
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
                  Player Full Name
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
                    Player Username
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
                    placeholder="player01"
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
                    3-20 letters and numbers only (e.g. player01, player03)
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
                    type={showCreatePassword ? "text" : "password"}
                    placeholder="Min 6 characters"
                    className="h-10 bg-background/70 border-border text-foreground pr-10 text-xs rounded-xl"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword(!showCreatePassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
                    aria-label={showCreatePassword ? "Hide password" : "Show password"}
                  >
                    {showCreatePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
                  {isLoading ? 'Registering Player...' : 'Create Player Account'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Compact Grid Layout (3 cols left vs 9 cols right) */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 min-h-[600px]">
        {/* --- LEFT SIDE: COMPACT PLAYERS LIST (md:col-span-1 = 20%) --- */}
        <div className={`md:col-span-1 space-y-2.5 ${showMobileDetail ? 'hidden md:block' : 'block'}`}>
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground/70" />
            <Input 
              placeholder="Search players..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-card border-border/80 text-foreground text-xs rounded-xl focus:border-primary/50 shadow-xs" 
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-[10px] text-muted-foreground hover:text-foreground font-bold"
              >
                Clear
              </button>
            )}
          </div>

          {/* Compact Player Cards List Container */}
          <div className="space-y-1.5 max-h-[620px] overflow-y-auto pr-0.5 custom-scrollbar">
            {isLoadingPlayers ? (
              [1, 2, 3, 4, 5].map((i) => (
                <Card key={i} className="p-2.5 border-border/60 bg-card/60 animate-pulse space-y-1.5 rounded-xl">
                  <div className="flex justify-between items-center">
                    <div className="h-3.5 bg-secondary/80 rounded w-1/3" />
                    <div className="h-3.5 bg-secondary/60 rounded-full w-12" />
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="h-3 bg-secondary/60 rounded w-1/4" />
                    <div className="h-3.5 bg-secondary/80 rounded w-16" />
                  </div>
                </Card>
              ))
            ) : filteredPlayers.length > 0 ? (
              filteredPlayers.map((player) => {
                const isSelected = selectedPlayer?.id === player.id
                const isPlayerOnline = player.is_online && player.is_active
                return (
                  <button
                    key={player.id}
                    onClick={() => handleSelectPlayer(player)}
                    className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col space-y-1 ${
                      isSelected
                        ? 'bg-primary/10 border-primary shadow-xs text-foreground'
                        : 'bg-card border-border/70 hover:bg-secondary/40 text-foreground'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 min-w-0">
                        <div className="relative shrink-0">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-[11px] ${
                            isSelected ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary border border-primary/20'
                          }`}>
                            {player.full_name[0]?.toUpperCase()}
                          </div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
                            isPlayerOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                          }`} />
                        </div>
                        <span className="font-extrabold text-xs truncate leading-tight">{player.full_name}</span>
                      </div>
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.2 text-[9px] font-black shrink-0 ${playerStatus(player).badgeClass}`}>
                        {playerStatus(player).label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/30">
                      <span className="text-muted-foreground font-mono text-[10px] truncate">@{player.username} &bull; {accountCodeLabel(player.account_code)}</span>
                      {isRefreshing || isLoadingPlayers ? (
                        <div className="h-3.5 w-12 bg-secondary/80 rounded animate-pulse shrink-0" />
                      ) : (
                        <span className="font-mono font-black text-foreground text-xs">{formatCurrency(player.coin_balance)}</span>
                      )}
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground font-medium bg-card rounded-xl border border-border">
                No players found.
              </div>
            )}
          </div>
        </div>

        {/* --- RIGHT SIDE: MAIN PLAYER DETAILS & HISTORY (md:col-span-4 = 80%) --- */}
        <div className={`md:col-span-4 space-y-3 ${showMobileDetail ? 'block' : 'hidden md:block'}`}>
          {selectedPlayer ? (
            <div className="space-y-3">
              {/* Selected Player Header Card (ULTRA COMPACT) */}
              <Card className="border-border/80 bg-card p-3 sm:p-3.5 rounded-2xl shadow-md space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  {/* Player Avatar, Name & Online/Offline Status (Issue #92:
                      this is the player's own session activity from
                      active_sessions, not the dashboard's Realtime status --
                      was mislabeled "Real-Time Sync Active" before) */}
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <button
                      onClick={() => setShowMobileDetail(false)}
                      className="md:hidden p-1.5 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 focus:outline-none shrink-0"
                      aria-label="Back to players list"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>

                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-sm">
                        {selectedPlayer.full_name[0]?.toUpperCase()}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
                        selectedPlayer.is_online && selectedPlayer.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                      }`} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <h2 className="text-sm sm:text-base font-black text-foreground truncate">{selectedPlayer.full_name}</h2>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black shrink-0 ${playerStatus(selectedPlayer).badgeClass}`}>
                          {playerStatus(selectedPlayer).label}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-[10px] font-mono">
                        <span className="text-muted-foreground truncate">@{selectedPlayer.username}</span>
                        <span className="text-muted-foreground/60">&bull;</span>
                        <span className="text-foreground font-bold shrink-0">ID {accountCodeLabel(selectedPlayer.account_code)}</span>
                        <span className="text-muted-foreground/60">&bull;</span>
                        {selectedPlayer.is_online && selectedPlayer.is_active ? (
                          <span className="inline-flex items-center text-emerald-400 font-extrabold text-[9px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-ping" />
                            Player Online
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-red-400/80 font-bold text-[9px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1" />
                            Player Offline
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Balance Summary Pill */}
                  <div className="bg-secondary/40 border border-border/60 px-3 py-1.5 rounded-xl flex items-center justify-between sm:justify-end space-x-2.5 shrink-0">
                    <div className="text-left sm:text-right">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">
                        Coins Balance
                      </span>
                      {isRefreshing || isLoadingPlayers ? (
                        <div className="h-5 w-16 bg-secondary/80 rounded animate-pulse mt-0.5" />
                      ) : (
                        <span className="text-base font-mono font-black text-foreground">
                          {formatCurrency(selectedPlayer.coin_balance)}
                        </span>
                      )}
                    </div>
                    <div className="p-1 rounded-lg bg-primary/10 text-primary">
                      <Coins className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </div>

                {/* Quick Actions Bar (Compact Buttons: h-8) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-2 border-t border-border/50">
                  {/* Deposit Modal */}
                  <Dialog open={activeTransferModal === 'deposit'} onOpenChange={(open) => {
                    setActiveTransferModal(open ? 'deposit' : null)
                    setTransferAmount('')
                    setTransferError(null)
                    setTransferSuccess(null)
                  }}>
                    <DialogTrigger className="w-full h-8 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold shadow-sm cursor-pointer rounded-lg text-[11px] flex items-center justify-center border-0">
                      <ArrowUpRight className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Deposit Coins
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
                      <DialogHeader>
                        <DialogTitle className="font-black text-lg">Deposit Coins</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                          Issue cashier coins to {selectedPlayer.full_name} (@{selectedPlayer.username}).
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 py-2">
                        {transferError && (
                          <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                            {transferError}
                          </div>
                        )}
                        {transferSuccess && (
                          <div className="p-2.5 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center space-x-2">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                            <span>{transferSuccess}</span>
                          </div>
                        )}
                        <div className="space-y-1">
                          <Label htmlFor="deposit-amount" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Amount (Coins)
                          </Label>
                          <Input 
                            id="deposit-amount"
                            type="number"
                            step="1"
                            min="1"
                            placeholder="e.g. 500"
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            className="h-10 bg-background border-border text-foreground text-xs rounded-lg" 
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          onClick={() => handleTransferPoints('deposit')} 
                          disabled={isTransferring || !!transferSuccess}
                          className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold cursor-pointer rounded-lg text-xs"
                        >
                          {isTransferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {isTransferring ? 'Processing...' : 'Confirm Deposit'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Withdraw Modal */}
                  <Dialog open={activeTransferModal === 'withdraw'} onOpenChange={(open) => {
                    setActiveTransferModal(open ? 'withdraw' : null)
                    setTransferAmount('')
                    setTransferError(null)
                    setTransferSuccess(null)
                  }}>
                    <DialogTrigger className="w-full h-8 border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 font-extrabold cursor-pointer rounded-lg text-[11px] flex items-center justify-center bg-transparent">
                      <ArrowDownRight className="mr-1 h-3.5 w-3.5 stroke-[3]" /> Withdraw
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
                      <DialogHeader>
                        <DialogTitle className="font-black text-lg">Withdraw Coins</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                          Deduct cashier coins from {selectedPlayer.full_name} (@{selectedPlayer.username}).
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 py-2">
                        {transferError && (
                          <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                            {transferError}
                          </div>
                        )}
                        {transferSuccess && (
                          <div className="p-2.5 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center space-x-2">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                            <span>{transferSuccess}</span>
                          </div>
                        )}
                        <div className="space-y-1">
                          <Label htmlFor="withdraw-amount" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Amount (Coins)
                          </Label>
                          <Input 
                            id="withdraw-amount"
                            type="number"
                            step="1"
                            min="1"
                            placeholder="e.g. 200"
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            className="h-10 bg-background border-border text-foreground text-xs rounded-lg" 
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          onClick={() => handleTransferPoints('withdraw')} 
                          disabled={isTransferring || !!transferSuccess}
                          className="w-full h-10 bg-destructive text-destructive-foreground hover:bg-destructive/90 font-extrabold cursor-pointer rounded-lg text-xs"
                        >
                          {isTransferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {isTransferring ? 'Processing...' : 'Confirm Withdrawal'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Reset Password Modal -- shared component, also used by the
                      Alerts page so a security notification can trigger the
                      exact same flow directly. */}
                  <ResetPasswordDialog
                    playerId={selectedPlayer.id}
                    playerName={selectedPlayer.full_name}
                    playerUsername={selectedPlayer.username}
                    onSuccess={() => loadPlayers()}
                    trigger={
                      <button className="w-full h-8 border border-primary/40 text-primary hover:bg-primary/10 cursor-pointer text-[11px] font-extrabold rounded-lg flex items-center justify-center bg-transparent">
                        <KeyRound className="mr-1 h-3.5 w-3.5" /> Password
                      </button>
                    }
                  />

                  {/* Status Toggle Button -- except for an auto-lock (5 failed
                      logins), where reactivating directly is intentionally not
                      offered: a plain, non-interactive label instead, since the
                      only intended way out of that state is a password reset
                      (which clears it automatically). A deliberate agent block
                      (auto_locked_at null) keeps the normal working button. */}
                  {!selectedPlayer.is_active && selectedPlayer.auto_locked_at ? (
                    <div className="w-full h-8 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-400 text-[11px] font-extrabold flex items-center justify-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" />
                      Temporary Block
                    </div>
                  ) : (
                    <Button
                      onClick={handleToggleStatus}
                      disabled={isTogglingStatus}
                      variant="outline"
                      className={`w-full h-8 font-extrabold cursor-pointer rounded-lg text-[11px] flex items-center justify-center ${
                        selectedPlayer.is_active
                          ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                          : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                      }`}
                    >
                      {isTogglingStatus ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : (
                        selectedPlayer.is_active ? <UserX className="mr-1 h-3.5 w-3.5" /> : <UserCheck className="mr-1 h-3.5 w-3.5" />
                      )}
                      {selectedPlayer.is_active ? 'Disable Player' : 'Activate Player'}
                    </Button>
                  )}
                  {toggleStatusError && (
                    <div className="p-2 text-[10px] font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
                      {toggleStatusError}
                    </div>
                  )}
                </div>
              </Card>

              <Card className="border-border/80 bg-card rounded-2xl overflow-hidden shadow-md">
                {/* Filter Toolbar (Date Picker + Quick Filters) */}
                <div className="p-3 border-b border-border/60 bg-secondary/10 flex flex-wrap items-center justify-between gap-2.5">
                  {/* Left Side: Tabs */}
                  <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5">
                    <button
                      onClick={() => setActiveTab('games')}
                      className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
                        activeTab === 'games' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Gamepad2 className="h-3.5 w-3.5 text-primary" />
                      <span>Game Plays</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('points')}
                      className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
                        activeTab === 'points' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Coins className="h-3.5 w-3.5 text-amber-400" />
                      <span>Cashier Transfers</span>
                      <span className="text-[10px] text-muted-foreground">({filteredPoints.length})</span>
                    </button>
                  </div>

                  {/* Right Side: Date Picker & Quick Filter Pills */}
                  <div className="flex items-center flex-wrap gap-1.5 sm:gap-2">
                    {/* Day filter for the Coins tab (the Game Plays tab has its own
                        filters inside PlayerGameHistory) */}
                    {activeTab !== 'games' && (
                      <>
                        {/* Today / Lifetime Quick Date Presets */}
                        <div className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] font-bold">
                          <button
                            // Issue #90 fix: "Today" is a real instant, so it
                            // genuinely needs the IST-aware conversion (unlike a
                            // Calendar pick below, which does not).
                            onClick={() => setFilterDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))}
                            className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer ${
                              filterDate === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
                                ? 'bg-primary text-primary-foreground font-black shadow-xs'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            Today
                          </button>
                          <button
                            onClick={() => setFilterDate(undefined)}
                            className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer ${
                              !filterDate
                                ? 'bg-primary text-primary-foreground font-black shadow-xs'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            Lifetime
                          </button>
                        </div>

                        {/* Date Picker Popover */}
                        <Popover>
                          <PopoverTrigger className="h-8 px-2.5 text-[11px] font-extrabold border border-border/80 bg-card hover:bg-secondary/60 rounded-xl flex items-center justify-center cursor-pointer">
                            <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                            {/* Display-only: parsed back to a local Date purely to
                                format it, never compared or sent anywhere. */}
                            {filterDate ? new Date(`${filterDate}T00:00:00`).toLocaleDateString() : 'Custom Date'}
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0 bg-card border-border" align="end">
                            <Calendar
                              mode="single"
                              selected={filterDate ? new Date(`${filterDate}T00:00:00`) : undefined}
                              // Issue #90 fix: a Calendar pick has no real instant
                              // to convert -- pickedDayKey reads back exactly the
                              // day the widget shows, in its own local frame.
                              onSelect={(d) => setFilterDate(d ? pickedDayKey(d) : undefined)}
                              disabled={(date) => date > new Date()}
                            />
                          </PopoverContent>
                        </Popover>

                        {filterDate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFilterDate(undefined)}
                            className="h-8 px-2 text-[10px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            <X className="mr-1 h-3 w-3" /> Clear
                          </Button>
                        )}

                      </>
                    )}
                  </div>
                </div>

                {/* Tab Content Display */}
                <div className="overflow-hidden">
                  {activeTab === 'games' && selectedPlayer ? (
                    <PlayerGameHistory
                      key={selectedPlayer.id}
                      playerIdentifier={selectedPlayer.id}
                      playerFullName={selectedPlayer.full_name}
                      playerUsername={selectedPlayer.username}
                    />
                  ) : isLoadingHistory ? (
                    <div className="p-4 space-y-2.5">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-secondary/20 animate-pulse border border-border/40">
                          <div className="h-3.5 bg-secondary/80 rounded w-1/4" />
                          <div className="h-3.5 bg-secondary/60 rounded w-1/3" />
                          <div className="h-3.5 bg-secondary/70 rounded w-1/6" />
                          <div className="h-3.5 bg-secondary/80 rounded w-1/5" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    filteredPoints.length > 0 ? (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                              <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[110px]">Transaction ID</TableHead>
                              <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[130px]">Date & Time</TableHead>
                              <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider min-w-[90px]">Type</TableHead>
                              <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[90px]">Amount</TableHead>
                              <TableHead className="text-right text-muted-foreground text-[10px] uppercase tracking-wider min-w-[110px]">Balance After</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paginatedPoints.map((tx) => (
                              <TableRow key={tx.id} className="border-border hover:bg-secondary/30 transition-colors">
                                <TableCell className="font-mono text-[11px] font-bold text-foreground p-2.5">{tx.id}</TableCell>
                                <TableCell className="text-[11px] text-muted-foreground p-2.5">{tx.created_at}</TableCell>
                                <TableCell className="text-[11px] p-2.5">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[9px] font-black uppercase ${
                                    tx.direction === 'deposit'
                                      ? 'bg-success-bg text-success-text border border-emerald-500/20'
                                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {tx.label}
                                  </span>
                                </TableCell>
                                <TableCell className={`text-right font-mono text-[11px] font-extrabold p-2.5 ${
                                  tx.direction === 'deposit' ? 'text-success-text' : 'text-amber-400'
                                }`}>
                                  {tx.direction === 'deposit' ? `+${formatCurrency(tx.amount)}` : `-${formatCurrency(tx.amount)}`}
                                </TableCell>
                                <TableCell className="text-right font-mono text-[11px] font-bold text-foreground p-2.5">
                                  {formatCurrency(tx.balance_after)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        {filteredPoints.length > itemsPerPage && (
                          <div className="p-3 border-t border-border/60">
                            <ResponsivePagination
                              currentPage={pointsPage}
                              totalPages={Math.ceil(filteredPoints.length / itemsPerPage)}
                              onPageChange={setPointsPage}
                              totalItems={filteredPoints.length}
                              itemsPerPage={itemsPerPage}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="p-10 text-center text-xs text-muted-foreground font-medium">
                        No cashier transfers recorded for the selected filter.
                      </div>
                    )
                  )}
                </div>
              </Card>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-12 text-center border border-border/60 bg-card rounded-2xl">
              <p className="text-xs text-muted-foreground font-medium">Select a player from the list to view details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
