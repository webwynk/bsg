"use client"

import { useState, useEffect, useCallback } from 'react'
import { getLatestGameDrawsAction } from '../actions'
import { ErrorBanner } from '@/components/error-banner'
import { 
  Radio, 
  RefreshCw, 
  Clock, 
  Loader2, 
  Trophy, 
  Sparkles, 
  Search, 
  Filter, 
  ChevronLeft, 
  ChevronRight, 
  History, 
  Gamepad2
} from 'lucide-react'

interface PlayerBet {
  username: string
  total_stake: number
  total_payout: number
}

interface GameDraw {
  round_id: string
  round_number: number
  hand_id: string
  red: number
  green: number
  black: number
  result: string
  total_stake: number
  total_payout: number
  player_count: number
  outcome: 'WON' | 'LOST' | 'NO BETS'
  created_at: string
  player_bets: PlayerBet[]
}

interface ActiveRound {
  round_number: number
  round_id: string
  phase: string
  seconds_remaining: number
  seconds_into: number
  draw_at_second: number
  has_digits: boolean
  red: number | null
  green: number | null
  black: number | null
}

export default function SuperAdminLiveGamePage() {
  const [latestDraws, setLatestDraws] = useState<GameDraw[]>([])
  const [activeRound, setActiveRound] = useState<ActiveRound | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [expandedDrawId, setExpandedDrawId] = useState<string | null>(null)
  const [selectedGameTab, setSelectedGameTab] = useState<'triple_chance' | 'game2' | 'game3'>('triple_chance')
  const [nowTime, setNowTime] = useState(Date.now())
  // Issue #15: page-load error surfaced to the user instead of silently
  // leaving latestDraws/activeRound stale on a backend failure.
  const [loadError, setLoadError] = useState<string | null>(null)

  // Table search & filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'WON' | 'LOST' | 'NO BETS'>('ALL')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 8

  // Live second ticker
  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Fetch draws from server action
  const loadDraws = useCallback(async (showIndicator = false) => {
    if (showIndicator) setIsRefreshing(true)
    try {
      const res = await getLatestGameDrawsAction()
      setLoadError(res.error)
      if (!res.error) {
        setLatestDraws(res.draws)
        setActiveRound(res.active_round)
      }
    } catch (e) {
      console.error('Error loading game draws:', e)
      setLoadError(e instanceof Error ? e.message : 'Could not load game draws.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  // Initial load + 5-second background auto-polling
  useEffect(() => {
    loadDraws(false)
    const pollInterval = setInterval(() => loadDraws(false), 5000)
    return () => clearInterval(pollInterval)
  }, [loadDraws])

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 0
    }).format(val) + ' Coins'
  }

  // Filtered draws for historical table
  const filteredDraws = latestDraws.filter(draw => {
    // Housekeeping #25 fix: the placeholder promised "outcome or player"
    // search, but player_bets[].username was never actually checked.
    const matchesSearch =
      draw.result.toString().includes(searchQuery) ||
      draw.hand_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      draw.round_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (draw.player_bets ?? []).some(pb => pb.username.toLowerCase().includes(searchQuery.toLowerCase()))

    // Housekeeping #25 fix: total_payout === 0 is true for BOTH a genuine
    // loss and a round nobody bet on -- the two were indistinguishable to
    // this filter. draw.outcome is the server's own, already-correct 3-way
    // classification; reading it directly instead of re-deriving a guess
    // from total_payout is what actually tells the two cases apart.
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'WON' && draw.outcome === 'WON') ||
      (statusFilter === 'LOST' && draw.outcome === 'LOST') ||
      (statusFilter === 'NO BETS' && draw.outcome === 'NO BETS')

    return matchesSearch && matchesStatus
  })

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredDraws.length / itemsPerPage))
  const paginatedDraws = filteredDraws.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <ErrorBanner error={loadError} />
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card p-4 sm:p-5 rounded-2xl border border-border shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">Live Game Telemetry</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Sync
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              Real-time 24/7 global round outcome monitor & draw history ledger.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-end sm:self-center">
          <span className="text-[10px] font-mono text-muted-foreground bg-secondary/50 px-2.5 py-1 rounded-lg border border-border/60">
            Auto-Sync (5s)
          </span>
          <button
            onClick={() => loadDraws(true)}
            disabled={isRefreshing}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-secondary hover:bg-secondary/80 border border-border text-foreground transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Game Selector Tabs */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2">
        <div className="flex items-center space-x-1 sm:space-x-2">
          <button
            onClick={() => setSelectedGameTab('triple_chance')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              selectedGameTab === 'triple_chance'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Gamepad2 className="h-4 w-4" />
            <span>Triple Chance</span>
          </button>

          <button
            disabled
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold text-muted-foreground/40 bg-secondary/20 cursor-not-allowed border border-border/30"
          >
            <span>Game 2</span>
            <span className="text-[9px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground font-semibold">Soon</span>
          </button>

          <button
            disabled
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold text-muted-foreground/40 bg-secondary/20 cursor-not-allowed border border-border/30"
          >
            <span>Game 3</span>
            <span className="text-[9px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground font-semibold">Soon</span>
          </button>
        </div>
      </div>

      {/* Main Active View */}
      {selectedGameTab === 'triple_chance' && (
        <div className="space-y-5">
          {(() => {
            const latest = latestDraws.length > 0 ? latestDraws[0] : null
            const drawTime = latest?.created_at ? new Date(latest.created_at).getTime() : 0
            const diffSecs = latest ? Math.max(0, Math.floor((nowTime - drawTime) / 1000)) : 999999
            const isRecentCompletion = latest && diffSecs <= 15

            // 90s UTC countdown calculation
            const utcSecs = Math.floor(nowTime / 1000)
            const cycleRem = 103 - (utcSecs % 103)
            const roundCountdown = cycleRem >= 14 ? cycleRem - 13 : 0

            // Active Round Outcome Preview for SuperAdmin (God Mode)
            if (activeRound) {
              const hasDigits = activeRound.red !== null && activeRound.red !== undefined
              return (
                <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-r from-amber-950/20 via-card to-background border border-amber-500/40 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center space-x-1.5 animate-pulse">
                        <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                        <span>
                          {hasDigits 
                            ? `⚡ God Mode Outcome Revealed (Round #${activeRound.round_number})` 
                            : `⚡ Accumulating 70s Wagers & Exposure (Round #${activeRound.round_number})`}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        {activeRound.phase === 'spinning' ? 'Spinning Phase' : 'Betting Phase (Live)'}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-xl border border-amber-500/20">
                      <Clock className="h-4 w-4" />
                      <span>{roundCountdown}s remaining in round</span>
                    </div>
                  </div>

                  {hasDigits ? (
                    /* Pre-Calculated Winning Digits Display (Second 71+) */
                    <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                      <div className="flex items-center space-x-3 sm:space-x-4">
                        {/* Red Digit (1st) */}
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] font-extrabold uppercase text-muted-foreground mb-1">Red (1st)</span>
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-red-600/20 border-2 border-red-500 text-red-400 flex items-center justify-center text-xl sm:text-3xl font-black font-mono shadow-md">
                            {activeRound.red}
                          </div>
                        </div>

                        <span className="text-muted-foreground/40 font-black text-2xl mt-4">+</span>

                        {/* Green Digit (2nd) */}
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] font-extrabold uppercase text-muted-foreground mb-1">Green (2nd)</span>
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-emerald-600/20 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center text-xl sm:text-3xl font-black font-mono shadow-md">
                            {activeRound.green}
                          </div>
                        </div>

                        <span className="text-muted-foreground/40 font-black text-2xl mt-4">+</span>

                        {/* Black Digit (3rd) */}
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] font-extrabold uppercase text-muted-foreground mb-1">Black (3rd)</span>
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-neutral-800 border-2 border-neutral-600 text-foreground flex items-center justify-center text-xl sm:text-3xl font-black font-mono shadow-md">
                            {activeRound.black}
                          </div>
                        </div>
                      </div>

                      {/* Combination Result Badge */}
                      <div className="flex flex-col items-start sm:items-end">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">3-Digit Pre-Result</span>
                        <div className="text-3xl sm:text-5xl font-black font-mono tracking-widest text-amber-400 bg-amber-500/10 px-4 py-1.5 rounded-2xl border border-amber-500/30 mt-1">
                          {`${activeRound.red}${activeRound.green}${activeRound.black}`}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Wager Accumulation Phase Display (0s to 70s) */
                    <div className="flex items-center justify-between flex-wrap gap-3 py-4 px-5 rounded-2xl bg-amber-500/5 border border-amber-500/20">
                      <div className="flex items-center space-x-3">
                        <Loader2 className="h-6 w-6 text-amber-400 animate-spin shrink-0" />
                        <div>
                          <div className="text-sm font-black text-foreground">Collecting Live Player Wagers & Exposure (0s ──► 70s)</div>
                          <div className="text-xs font-semibold text-muted-foreground mt-0.5">
                            RTP Engine will analyze all bets and calculate the optimal winning combination at <strong className="text-amber-400">20s remaining (Second 71)</strong>.
                          </div>
                        </div>
                      </div>
                      <span className="px-3 py-1 text-xs font-mono font-bold rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {roundCountdown > 20 ? `${roundCountdown - 20}s until calculation` : 'Calculating now...'}
                      </span>
                    </div>
                  )}

                  <p className="text-xs text-amber-300/80 font-medium pt-2 border-t border-amber-500/20 flex items-center space-x-1">
                    <span>⚡ <strong>God Mode Telemetry:</strong> At Second 71 (20s remaining), the 70s snapshot RTP calculation completes and reveals the winning numbers here to SuperAdmin.</span>
                  </p>
                </div>
              )
            }

            // STATE 2: Mobile Spin Complete - Featured Real Winning Result (15 seconds display)
            if (!latest) return null

            let relativeTimeStr = 'Just now'
            if (diffSecs >= 5 && diffSecs < 60) relativeTimeStr = `${diffSecs}s ago`
            else if (diffSecs >= 60 && diffSecs < 3600) relativeTimeStr = `${Math.floor(diffSecs / 60)}m ago`
            else if (diffSecs >= 3600) relativeTimeStr = `${Math.floor(diffSecs / 3600)}h ago`

            return (
              <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-r from-purple-950/30 via-card to-background border border-purple-500/30 space-y-4 shadow-inner">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse flex items-center space-x-1.5">
                      <Trophy className="h-3.5 w-3.5 text-amber-400" />
                      <span>🏆 Latest Winning Result (Just Completed)</span>
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5 text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-xl border border-amber-500/20">
                    <Clock className="h-4 w-4" />
                    <span>{relativeTimeStr}</span>
                  </div>
                </div>

                {/* Color-Coded 3-Digit Winning Outcome Display */}
                <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                  <div className="flex items-center space-x-3 sm:space-x-4">
                    {/* Red Digit (1st) */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-extrabold uppercase text-muted-foreground mb-1">Red (1st)</span>
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-red-600/20 border-2 border-red-500 text-red-400 flex items-center justify-center text-xl sm:text-3xl font-black font-mono shadow-md">
                        {latest.red}
                      </div>
                    </div>

                    <span className="text-muted-foreground/40 font-black text-2xl mt-4">+</span>

                    {/* Green Digit (2nd) */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-extrabold uppercase text-muted-foreground mb-1">Green (2nd)</span>
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-emerald-600/20 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center text-xl sm:text-3xl font-black font-mono shadow-md">
                        {latest.green}
                      </div>
                    </div>

                    <span className="text-muted-foreground/40 font-black text-2xl mt-4">+</span>

                    {/* Black Digit (3rd) */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-extrabold uppercase text-muted-foreground mb-1">Black (3rd)</span>
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-neutral-800 border-2 border-neutral-600 text-foreground flex items-center justify-center text-xl sm:text-3xl font-black font-mono shadow-md">
                        {latest.black}
                      </div>
                    </div>
                  </div>

                  {/* Combination Result Badge */}
                  <div className="flex flex-col items-start sm:items-end">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">3-Digit Result</span>
                    <div className="text-3xl sm:text-5xl font-black font-mono tracking-widest text-primary bg-primary/10 px-4 py-1.5 rounded-2xl border border-primary/30 mt-1">
                      {latest.result}
                    </div>
                  </div>
                </div>

                {/* Round Financial Breakdown */}
                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-purple-500/20 text-xs sm:text-sm">
                  <div>
                    <span className="text-muted-foreground font-semibold block text-[10px]">Player:</span>
                    <span className="font-extrabold font-mono text-foreground">@{latest.hand_id}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground font-semibold block text-[10px]">Wagered:</span>
                    <span className="font-extrabold font-mono text-foreground">{formatCurrency(latest.total_stake)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground font-semibold block text-[10px]">Net Payout:</span>
                    <span className={`font-extrabold font-mono ${latest.total_payout > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                      {latest.total_payout > 0 ? `+${formatCurrency(latest.total_payout)}` : '0 Coins'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Recent Draw Stream (Horizontal Chips Carousel) */}
          {latestDraws.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center space-x-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>Recent Draw Stream (Last 10 Rounds)</span>
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">Live Feed</span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {latestDraws.map(draw => {
                  const drawTime = draw.created_at ? new Date(draw.created_at).getTime() : Date.now()
                  const diffSecs = Math.max(0, Math.floor((nowTime - drawTime) / 1000))
                  let relTime = 'Just now'
                  if (diffSecs >= 5 && diffSecs < 60) relTime = `${diffSecs}s ago`
                  else if (diffSecs >= 60 && diffSecs < 3600) relTime = `${Math.floor(diffSecs / 60)}m ago`
                  else if (diffSecs >= 3600) relTime = `${Math.floor(diffSecs / 3600)}h ago`

                  return (
                    <div
                      key={draw.round_id}
                      className="px-3 py-2 rounded-xl bg-card border border-border/80 shrink-0 flex items-center space-x-2.5 text-xs font-mono shadow-xs hover:border-primary/40 transition-colors"
                    >
                      <span className="text-[10px] text-muted-foreground font-semibold">{relTime}</span>
                      <div className="flex items-center space-x-1 font-bold">
                        <span className="text-red-400">{draw.red}</span>
                        <span className="text-muted-foreground/50 text-[10px]">•</span>
                        <span className="text-emerald-400">{draw.green}</span>
                        <span className="text-muted-foreground/50 text-[10px]">•</span>
                        <span className="text-foreground">{draw.black}</span>
                      </div>
                      <span className="font-extrabold text-primary bg-primary/10 px-2 py-0.5 rounded-lg text-xs border border-primary/20">
                        {draw.result}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Historical Draw History Table & Ledger */}
          <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-xs space-y-4 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/60 pb-3">
              <div className="flex items-center space-x-2">
                <History className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-extrabold tracking-tight text-foreground">Complete Game Draw Ledger</h3>
                <span className="text-[10px] text-muted-foreground font-semibold bg-secondary px-2 py-0.5 rounded-full">
                  {filteredDraws.length} Records
                </span>
              </div>

              {/* Search and Filters */}
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <div className="relative flex-1 sm:w-48">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search outcome or player..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-xl focus:outline-none focus:border-primary font-medium"
                  />
                </div>

                <div className="flex items-center space-x-1 bg-secondary/50 p-1 rounded-xl border border-border">
                  <Filter className="h-3 w-3 text-muted-foreground ml-1" />
                  <button
                    onClick={() => { setStatusFilter('ALL'); setCurrentPage(1); }}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all ${
                      statusFilter === 'ALL' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => { setStatusFilter('WON'); setCurrentPage(1); }}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all ${
                      statusFilter === 'WON' ? 'bg-emerald-500 text-white' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Won
                  </button>
                  <button
                    onClick={() => { setStatusFilter('LOST'); setCurrentPage(1); }}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all ${
                      statusFilter === 'LOST' ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Lost
                  </button>
                  {/* Housekeeping #25 fix: previously there was no way to
                      deliberately filter FOR empty rounds -- only the buggy
                      "Lost" filter silently included them. Now a real,
                      distinct choice, backed by the server's own outcome
                      field rather than a total_payout guess. */}
                  <button
                    onClick={() => { setStatusFilter('NO BETS'); setCurrentPage(1); }}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all ${
                      statusFilter === 'NO BETS' ? 'bg-secondary text-foreground border border-border' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    No Bets
                  </button>
                </div>
              </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground text-[10px] uppercase font-bold tracking-wider">
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Hand ID</th>
                    <th className="py-2.5 px-3">Digits (R • G • B)</th>
                    <th className="py-2.5 px-3">Wagered</th>
                    <th className="py-2.5 px-3 text-right">Net Payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground text-xs font-sans">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                        Loading game draws...
                      </td>
                    </tr>
                  ) : paginatedDraws.length > 0 ? (
                    paginatedDraws.flatMap(draw => {
                      const formattedTime = draw.created_at ? new Date(draw.created_at).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        day: '2-digit',
                        month: 'short'
                      }) : '—'

                      const isExpanded = expandedDrawId === draw.round_id;
                      const hasMultiple = draw.player_bets && draw.player_bets.length > 0;

                      return [
                        <tr
                          key={draw.round_id}
                          onClick={() => hasMultiple && setExpandedDrawId(isExpanded ? null : draw.round_id)}
                          className={`hover:bg-secondary/40 transition-colors ${hasMultiple ? 'cursor-pointer' : ''} ${isExpanded ? 'bg-secondary/30' : ''}`}
                        >
                          <td className="py-2.5 px-3 text-muted-foreground text-[11px] font-sans">{formattedTime}</td>
                          <td className="py-2.5 px-3 font-bold text-foreground font-sans">
                            {/* Housekeeping #25 fix: this cell used to be split across two
                                separate columns ("Hand ID" showing round_id.slice(-8), and a
                                mislabeled "Player" column showing the exact same value again
                                via draw.hand_id) -- confirmed both rendered identical text.
                                Merged into one, now showing the full round_id (previously
                                truncated to 8 characters) instead of duplicating a shortened
                                copy of itself. The expand/collapse indicator, which used to
                                live in the now-deleted "Player" cell, moved here so it isn't
                                silently lost. */}
                            <span className="flex items-center space-x-1.5">
                              <span>{draw.round_id}</span>
                              {hasMultiple && (
                                <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.2 rounded font-mono shrink-0">
                                  {isExpanded ? '▲ Hide' : '▼ Details'}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center space-x-1.5 font-bold text-xs">
                              <span className="text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">{draw.red}</span>
                              <span className="text-muted-foreground/40">•</span>
                              <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">{draw.green}</span>
                              <span className="text-muted-foreground/40">•</span>
                              <span className="text-foreground bg-secondary px-1.5 py-0.5 rounded border border-border">{draw.black}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-foreground font-semibold">{formatCurrency(draw.total_stake)}</td>
                          <td className={`py-2.5 px-3 text-right font-extrabold ${draw.total_payout > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                            {draw.total_payout > 0 ? `+${formatCurrency(draw.total_payout)}` : '0 Coins'}
                          </td>
                        </tr>,
                        isExpanded && draw.player_bets && draw.player_bets.length > 0 && (
                          <tr key={`${draw.round_id}-expanded`} className="bg-secondary/20 border-b border-border/40">
                            <td colSpan={5} className="p-3">
                              <div className="bg-background/90 rounded-xl p-3 border border-border/60 space-y-2">
                                <div className="text-[11px] font-bold text-primary flex items-center justify-between border-b border-border/40 pb-1.5">
                                  <span>Participating Player Breakdown ({draw.player_bets.length} Players)</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-sans">
                                  {draw.player_bets.map((pb, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-secondary/40 px-2.5 py-1.5 rounded-lg border border-border/30">
                                      <span className="font-bold text-foreground">@{pb.username}</span>
                                      <div className="flex items-center space-x-2 text-[11px] font-mono">
                                        <span className="text-muted-foreground">Bet: {formatCurrency(pb.total_stake)}</span>
                                        <span className={pb.total_payout > 0 ? 'text-emerald-400 font-extrabold' : 'text-muted-foreground'}>
                                          {pb.total_payout > 0 ? `+${formatCurrency(pb.total_payout)}` : '0'}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )
                      ]
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground text-xs font-sans">
                        No game draws match your filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View (< 640px) */}
            <div className="block sm:hidden space-y-2.5">
              {isLoading ? (
                <div className="p-6 text-center text-muted-foreground text-xs">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                  Loading game draws...
                </div>
              ) : paginatedDraws.length > 0 ? (
                paginatedDraws.map(draw => {
                  const isExpanded = expandedDrawId === draw.round_id;
                  const hasMultiple = draw.player_bets && draw.player_bets.length > 0;

                  return (
                    <div
                      key={draw.round_id}
                      onClick={() => hasMultiple && setExpandedDrawId(isExpanded ? null : draw.round_id)}
                      className={`p-3 rounded-xl bg-secondary/30 border border-border/80 space-y-2 text-xs ${hasMultiple ? 'cursor-pointer' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        {/* Housekeeping #25 fix: full round_id instead of the
                            previous 8-character truncation, matching the
                            desktop table's fix. flex-wrap + break-all + a
                            smaller font size keep this responsive -- a full
                            UUID is ~36 characters, much longer than the old
                            short form, and this card has no horizontal
                            scroll to fall back on the way the desktop table
                            does. shrink-0 on the result badge below keeps it
                            fixed-width on the right regardless of how many
                            lines the id wraps to. */}
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                          <span className="font-bold text-foreground text-[10px] font-mono break-all">{draw.round_id}</span>
                          {hasMultiple && (
                            <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.2 rounded font-mono shrink-0">
                              {isExpanded ? '▲ Hide' : '▼ Details'}
                            </span>
                          )}
                        </div>
                        {/* Per-digit colored combined result, matching the
                            red/emerald/foreground convention already used
                            for the individual R.G.B digits below -- previously
                            a single uniformly-colored string. */}
                        <span className="font-extrabold bg-primary/10 px-2 py-0.5 rounded text-xs border border-primary/20 shrink-0 font-mono">
                          <span className="text-red-400">{draw.red}</span>
                          <span className="text-emerald-400">{draw.green}</span>
                          <span className="text-foreground">{draw.black}</span>
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center space-x-1 font-mono font-bold">
                          <span className="text-red-400">{draw.red}</span>
                          <span className="text-muted-foreground/40">•</span>
                          <span className="text-emerald-400">{draw.green}</span>
                          <span className="text-muted-foreground/40">•</span>
                          <span className="text-foreground">{draw.black}</span>
                        </div>
                        <span className={`font-extrabold ${draw.total_payout > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                          {draw.total_payout > 0 ? `+${formatCurrency(draw.total_payout)}` : '0 Coins'}
                        </span>
                      </div>

                      {isExpanded && draw.player_bets && draw.player_bets.length > 0 && (
                        <div className="pt-2 border-t border-border/40 space-y-1.5">
                          <div className="text-[10px] font-bold text-primary">Participating Players ({draw.player_bets.length})</div>
                          {draw.player_bets.map((pb, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-background/80 p-2 rounded-lg border border-border/40 text-[11px]">
                              <span className="font-bold text-foreground">@{pb.username}</span>
                              <div className="flex items-center space-x-2 font-mono">
                                <span className="text-muted-foreground">Bet: {formatCurrency(pb.total_stake)}</span>
                                <span className={pb.total_payout > 0 ? 'text-emerald-400 font-extrabold' : 'text-muted-foreground'}>
                                  {pb.total_payout > 0 ? `+${formatCurrency(pb.total_payout)}` : '0'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="p-4 text-center text-muted-foreground text-xs">
                  No game draws found.
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
                <span className="text-muted-foreground font-medium text-[11px]">
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg bg-secondary border border-border text-foreground hover:bg-secondary/80 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg bg-secondary border border-border text-foreground hover:bg-secondary/80 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
