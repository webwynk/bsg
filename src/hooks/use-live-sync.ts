"use client"

import * as React from "react"
import { useLiveVersion, type LiveTable } from "@/components/live-data-provider"

export type LiveSyncTier = "fast" | "normal"

/** Poll interval per tier, in ms -- the guaranteed worst-case staleness
 *  bound regardless of Realtime's state. 'fast' is for pages showing live
 *  gameplay/security outcomes (agent & player detail pages, live monitor,
 *  cashier, alerts); 'normal' is for summary/audit/directory pages, whose
 *  underlying queries are heavier (full-table scans) and whose staleness
 *  tolerance is higher. */
export const LIVE_SYNC_TIER_MS: Record<LiveSyncTier, number> = {
  fast: 3_000,
  normal: 10_000,
}

export interface LiveSyncStatus {
  /** Epoch ms of the last time this hook fired fetchFn, from ANY trigger
   *  (Realtime push or this hook's own poll). Null until the first fire.
   *  Measures "last sync attempted", not "last sync confirmed complete" --
   *  fetchFn's own promise isn't awaited here since none of the existing
   *  route fetch functions return it (fire-and-forget by established
   *  convention, each already self-guarding against out-of-order responses
   *  via useRequestGeneration). In practice these round-trips are
   *  consistently fast (tens to a few hundred ms, measured throughout this
   *  investigation), so attempted-at and completed-at are close enough for
   *  an honest human-facing "synced Xs ago" display. */
  lastSyncedAt: number | null
  /** This page's configured poll interval, in ms -- LiveSyncBadge uses this
   *  to judge whether lastSyncedAt is within the expected freshness window
   *  or actually stale (e.g. a suspended/frozen background tab), rather
   *  than assuming freshness forever once a badge starts as "live". */
  tierMs: number
}

/**
 * Single shared live-data mechanism for a page: calls fetchFn whenever the
 * given tables change via the portal's shared Realtime connection (the fast
 * path -- sub-second, measured at 227-426ms in this investigation, when
 * Realtime is actually delivering), AND independently on a fixed poll
 * interval regardless of Realtime's reported connection state (the
 * guaranteed backstop).
 *
 * Why a time-bound poll and not a smarter "wait for the real ready signal":
 * Issue #91's post-launch investigation found that Realtime's own server-side
 * authorization check (realtime.apply_rls) can fail silently and repeatedly
 * for a subscription that already reported success and stayed reported as
 * connected the whole time -- confirmed live via Supabase's own service logs
 * (PoolingReplicationError / permission denied for function
 * current_is_active) across multiple distinct connections and multiple
 * tables. There is no client-observable signal that distinguishes "actually
 * delivering" from "silently stuck", so no signal-based readiness check can
 * be trusted -- only a time-bounded poll actually guarantees a worst case.
 * See MASTER_AUDIT_AND_REMEDIATION_PLAN.md Issue #91 for the full evidence
 * chain.
 *
 * The poll pauses while the tab is hidden/backgrounded -- nobody is
 * watching a background tab, so there's no reason to spend the query, and
 * it resumes (with an immediate fetch) the instant the tab is refocused.
 *
 * fetchFn is expected to already guard against out-of-order responses
 * itself (via useRequestGeneration, the existing pattern on every route
 * this hook is used from) -- this hook only decides WHEN to call fetchFn,
 * never how many overlapping calls are safe, since that's already handled
 * per callsite.
 */
export function useLiveSync(
  tables: LiveTable[],
  fetchFn: () => void,
  tier: LiveSyncTier = "normal"
): LiveSyncStatus {
  const liveTick = useLiveVersion(tables)
  const [lastSyncedAt, setLastSyncedAt] = React.useState<number | null>(null)
  const tierMs = LIVE_SYNC_TIER_MS[tier]

  // Ref so the two effects below never need fetchFn itself in their dep
  // arrays -- callers pass a useCallback-memoized function already (matching
  // every existing route's own load function), but a ref removes any risk
  // of a poll/realtime effect re-subscribing on an incidental identity
  // change instead of only on the triggers that actually matter (liveTick,
  // tier, tab visibility). Assigned in its own effect (every render, no dep
  // array), not during render itself -- react-compiler/react-hooks forbids
  // writing a ref's .current outside an effect or event handler.
  const fetchFnRef = React.useRef(fetchFn)
  React.useEffect(() => {
    fetchFnRef.current = fetchFn
  })

  const runFetch = React.useCallback(() => {
    fetchFnRef.current()
    setLastSyncedAt(Date.now())
  }, [])

  // Realtime-driven fast path -- fires once on mount (liveTick reflects
  // LiveDataProvider's counters at mount time, which may already be nonzero
  // if arriving from another page within the same portal session) and again
  // every time any watched table's version bumps.
  //
  // runFetch (which calls setState) is wrapped in an async IIFE rather than
  // called directly at the top of the effect body -- same fix already
  // established in agent-notifications-provider.tsx: calling a
  // setState-triggering function synchronously there trips
  // react-hooks/set-state-in-effect.
  React.useEffect(() => {
    ;(async () => {
      runFetch()
    })()
  }, [liveTick, runFetch])

  // Guaranteed backstop -- independent of liveTick, so it still fires on
  // schedule even if the Realtime-driven effect above never fires again for
  // the rest of this page's lifetime.
  React.useEffect(() => {
    if (typeof document === "undefined") return

    let intervalId: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (intervalId) return
      intervalId = setInterval(runFetch, tierMs)
    }
    const stop = () => {
      if (!intervalId) return
      clearInterval(intervalId)
      intervalId = null
    }

    if (document.visibilityState === "visible") start()

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Catch up immediately on refocus rather than waiting up to tierMs
        // for the resumed interval's first tick -- a tab backgrounded for
        // minutes shouldn't leave stale data on screen for another few
        // seconds after the user comes back to look at it.
        runFetch()
        start()
      } else {
        stop()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [tierMs, runFetch])

  return React.useMemo(() => ({ lastSyncedAt, tierMs }), [lastSyncedAt, tierMs])
}
