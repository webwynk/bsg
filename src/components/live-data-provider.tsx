"use client"

import * as React from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase-browser"

export type LiveTable = 'profiles' | 'bets' | 'coin_ledger' | 'rounds'

const ALL_TABLES: LiveTable[] = ['profiles', 'bets', 'coin_ledger', 'rounds']

// One shared debounce across every table, not one per table -- a single bet
// placement typically writes both `bets` and `coin_ledger` within
// milliseconds of each other, and treating that as two separate refetch
// signals would just double the work for one real event. 300ms is enough for
// a burst to finish landing before any page using this is told to refetch.
const DEBOUNCE_MS = 300

// Insurance only, not the primary update path -- same reasoning as
// agent-notifications-provider.tsx's fallback poll, tightened from that
// file's 5 minutes to 90 seconds (user-confirmed) because this provider also
// carries financial data (balances, bets), not just rare security alerts. If
// the live connection ever silently drops (network blip, a backgrounded tab,
// a subscribe call that never actually completed), no page using this can be
// stale for longer than this interval before it self-corrects.
const FALLBACK_POLL_MS = 90_000

interface LiveDataContextValue {
  /** Per-table change counters. A page depends on the relevant slice of this
   *  (via useLiveVersion) in its own data-loading effect to know when to
   *  silently re-fetch -- this provider never fetches or holds the actual
   *  player/bet/balance data itself, only the "something changed" signal. */
  versions: Record<LiveTable, number>
  /** True once the Realtime channel has actually finished subscribing. Not
   *  required for correctness (the fallback timer above still bumps versions
   *  even if this never goes true) -- only useful for an optional "Live"
   *  indicator on a page. */
  isLive: boolean
}

const LiveDataContext = React.createContext<LiveDataContextValue | null>(null)

/**
 * Single source of live-data change signals for an entire portal session --
 * mounted once per portal layout (agent/layout.tsx, superadmin/layout.tsx),
 * exactly like AgentNotificationsProvider already is (same file confirms
 * that pattern means exactly one live subscription per active session, since
 * the two portal layouts are never both mounted for one session at once).
 *
 * No per-table Realtime filter is applied here -- RLS already scopes what a
 * given logged-in user receives correctly, the same way it already scopes
 * every regular query (an agent's subscription only ever receives events for
 * their own players' rows; a superadmin's receives everything). Verified
 * live against profiles_select/bets_select/coin_ledger_select/
 * rounds_select_settled as part of Issue #91's Phase 0 audit before this file
 * was written -- see MASTER_AUDIT_AND_REMEDIATION_PLAN.md.
 */
export function LiveDataProvider({ children }: { children: React.ReactNode }) {
  const [versions, setVersions] = React.useState<Record<LiveTable, number>>({
    profiles: 0,
    bets: 0,
    coin_ledger: 0,
    rounds: 0,
  })
  const [isLive, setIsLive] = React.useState(false)

  React.useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    let cancelled = false
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let pending = new Set<LiveTable>()

    const flush = () => {
      if (pending.size === 0) return
      const toBump = pending
      pending = new Set()
      setVersions(prev => {
        const next = { ...prev }
        for (const t of toBump) next[t] = next[t] + 1
        return next
      })
    }

    const scheduleBump = (table: LiveTable) => {
      pending.add(table)
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flush, DEBOUNCE_MS)
    }

    const channel = supabase
      .channel('live-data-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => scheduleBump('profiles'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, () => scheduleBump('bets'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coin_ledger' }, () => scheduleBump('coin_ledger'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, () => scheduleBump('rounds'))
      .subscribe((status) => {
        if (!cancelled) setIsLive(status === 'SUBSCRIBED')
      })

    const fallbackTimer = setInterval(() => {
      setVersions(prev => {
        const next = { ...prev }
        for (const t of ALL_TABLES) next[t] = next[t] + 1
        return next
      })
    }, FALLBACK_POLL_MS)

    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      clearInterval(fallbackTimer)
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <LiveDataContext.Provider value={{ versions, isLive }}>
      {children}
    </LiveDataContext.Provider>
  )
}

/**
 * Returns one number that changes whenever any of the given tables' versions
 * changes -- put it in a data-loading effect's dependency array to silently
 * re-fetch when relevant data changes, e.g.:
 *
 *   const liveTick = useLiveVersion(['profiles', 'bets'])
 *   React.useEffect(() => { loadPlayers() }, [liveTick])
 */
export function useLiveVersion(tables: LiveTable[]): number {
  const ctx = React.useContext(LiveDataContext)
  if (!ctx) throw new Error("useLiveVersion must be used within LiveDataProvider")
  return tables.reduce((sum, t) => sum + ctx.versions[t], 0)
}

/** True once the shared channel has actually subscribed -- for an optional
 *  "Live" indicator. Not required for pages to function correctly. */
export function useLiveConnectionStatus(): boolean {
  const ctx = React.useContext(LiveDataContext)
  if (!ctx) throw new Error("useLiveConnectionStatus must be used within LiveDataProvider")
  return ctx.isLive
}
