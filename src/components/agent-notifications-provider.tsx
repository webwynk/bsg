"use client"

import * as React from "react"
import { getAgentNotificationsAction, markNotificationReadAction, type AgentNotification } from "@/app/agent/players/actions"
import { createBrowserSupabaseClient } from "@/lib/supabase-browser"

interface AgentNotificationsContextValue {
  notifications: AgentNotification[]
  unreadCount: number
  loading: boolean
  refresh: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  /** Epoch ms of the last time refresh() actually completed, from ANY
   *  trigger (Realtime push, the fallback poll, or the initial load). For
   *  LiveSyncBadge -- see the note on FALLBACK_POLL_MS below for why this
   *  provider needs the same honest-sync-status treatment as useLiveSync's
   *  consumers, not just a static "connected" claim. */
  lastSyncedAt: number | null
  /** This provider's configured poll interval, in ms -- LiveSyncBadge uses
   *  this to judge whether lastSyncedAt is within the expected freshness
   *  window. */
  tierMs: number
}

const AgentNotificationsContext = React.createContext<AgentNotificationsContextValue | null>(null)

// Backup refresh only -- the primary update path is the Realtime
// subscription below, which shows a new alert as soon as it is inserted.
// History: 5 minutes, then the shared 3 s 'fast' tier (Issue #91 addendum,
// 2026-08-25, after a Realtime insert was seen silently not delivered), and
// since 2026-11-15 (dashboard server-call optimisation step 2, Hasan's
// choice) 180 s. Measured before that change: the notifications table had 0
// rows (28 ever) yet was read ~19,900 times, 20 times a minute per open tab.
// Alerts are account lockouts -- the account is already locked, so a missed
// push showing up to 3 minutes late is acceptable. The list still refreshes
// at once on tab refocus, on the Alerts page's Refresh button, and after a
// password reset from the Alerts page. Never trust Realtime as the only
// source of truth: a dropped WebSocket or a missed event still self-corrects
// within this interval. LiveSyncBadge reads this value (tierMs) and only turns "stale"
// after twice this long without a sync.
const FALLBACK_POLL_MS = 180_000

/**
 * Single source of truth for security alerts, read once here rather than
 * separately by the nav badge and the alerts page -- both read this same
 * context. Mounted twice in the app overall -- once in agent/layout.tsx,
 * once in superadmin/layout.tsx -- since the two portals are separate
 * layouts, never both on screen at once for a given session, so this still
 * means exactly one live subscription per active user at any moment.
 *
 * Previously a 15-second poll. Replaced with a Supabase Realtime
 * subscription (2026-08-11) -- the 15s interval meant most checks came back
 * with nothing new (alerts are rare), pure wasted requests, and it was also
 * one of the contributors to a real refresh-token collision bug diagnosed
 * earlier the same day (multiple independent pollers hitting Supabase Auth
 * close together). Realtime does work only when something actually happens,
 * and removes this component entirely from that collision surface.
 *
 * The subscription filter matters: notifications' RLS lets a superadmin see
 * every row regardless of agent_id (their narrower "staff lockouts only"
 * scoping is an application-level query filter in
 * getAgentNotificationsAction, not RLS) -- so the Realtime filter here has
 * to reproduce that same scoping itself (agent_id=is.null for superadmin,
 * agent_id=eq.<their id> for an agent), or a superadmin's browser would
 * start receiving individual player-lockout events RLS alone doesn't block.
 */
export function AgentNotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = React.useState<AgentNotification[]>([])
  const [loading, setLoading] = React.useState(true)
  const [lastSyncedAt, setLastSyncedAt] = React.useState<number | null>(null)

  // Issue #93 bug fix: this provider previously had NO ordering guard at
  // all -- unlike every page-level fetch in the dashboard (all of which use
  // useRequestGeneration), a response here always unconditionally overwrote
  // `notifications`, so two requests resolving out of order (a real
  // possibility: refresh() is called independently by the Realtime
  // subscription, the poll, tab-refocus, and every manual action below)
  // could let an older response silently clobber a newer one -- stale
  // account-lockout data, shown with no visible sign anything was wrong.
  // generationRef adds the same ordering guard every other route already
  // has. inFlightRef adds the same protection just given to useLiveSync's
  // own poll (see use-live-sync.ts): this provider's poll fires on the same
  // fixed schedule regardless of whether a previous refresh() call has
  // resolved, so if a round-trip ever runs long enough to approach
  // FALLBACK_POLL_MS, ticks could pile up faster than they resolve -- the
  // exact failure mode confirmed live to leave a Refresh button stuck
  // spinning elsewhere in the dashboard.
  const generationRef = React.useRef(0)
  const inFlightRef = React.useRef(false)

  const refresh = React.useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const token = ++generationRef.current
    try {
      const res = await getAgentNotificationsAction()
      if (token !== generationRef.current) return // superseded by a newer call
      if (!res.error) setNotifications(res.notifications)
      setLoading(false)
      setLastSyncedAt(Date.now())
    } finally {
      inFlightRef.current = false
    }
  }, [])

  React.useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    ;(async () => {
      // Inside the async setup, not called directly at the top of the effect
      // body -- calling a setState-triggering function synchronously there
      // trips react-hooks/set-state-in-effect (confirmed this was already
      // true of the pre-existing code before this rewrite, not introduced by
      // it -- fixed here since the file was already being rewritten anyway).
      await refresh()
      if (cancelled) return

      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled || !user) return

      const role = user.app_metadata?.role
      const filter = role === 'superadmin' ? 'agent_id=is.null' : `agent_id=eq.${user.id}`

      channel = supabase
        .channel('staff-notifications')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter },
          () => refresh()
        )
        .subscribe()
    })()

    // Guaranteed backstop, tab-visibility aware -- same reasoning and
    // pattern as useLiveSync's own poll (see use-live-sync.ts and
    // MASTER_AUDIT_AND_REMEDIATION_PLAN.md Issue #91): pauses while the tab
    // is backgrounded since nobody is watching it, and catches up
    // immediately on refocus instead of waiting for the next scheduled tick.
    let intervalId: ReturnType<typeof setInterval> | null = null
    const startPoll = () => {
      if (intervalId) return
      intervalId = setInterval(refresh, FALLBACK_POLL_MS)
    }
    const stopPoll = () => {
      if (!intervalId) return
      clearInterval(intervalId)
      intervalId = null
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh()
        startPoll()
      } else {
        stopPoll()
      }
    }
    if (typeof document !== "undefined") {
      if (document.visibilityState === "visible") startPoll()
      document.addEventListener("visibilitychange", onVisibilityChange)
    }

    return () => {
      cancelled = true
      stopPoll()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange)
      }
      if (channel) supabase.removeChannel(channel)
    }
  }, [refresh])

  const markRead = React.useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)))
    await markNotificationReadAction(id)
  }, [])

  const markAllRead = React.useCallback(async () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    await Promise.all(unreadIds.map(id => markNotificationReadAction(id)))
  }, [notifications])

  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <AgentNotificationsContext.Provider
      value={{ notifications, unreadCount, loading, refresh, markRead, markAllRead, lastSyncedAt, tierMs: FALLBACK_POLL_MS }}
    >
      {children}
    </AgentNotificationsContext.Provider>
  )
}

export function useAgentNotifications() {
  const ctx = React.useContext(AgentNotificationsContext)
  if (!ctx) throw new Error("useAgentNotifications must be used within AgentNotificationsProvider")
  return ctx
}
