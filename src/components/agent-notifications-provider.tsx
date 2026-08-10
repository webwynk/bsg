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
}

const AgentNotificationsContext = React.createContext<AgentNotificationsContextValue | null>(null)

// 5 minutes -- a safety net only, not the primary update path anymore (that's
// the Realtime subscription below). Never trust Realtime as the only source
// of truth: a dropped WebSocket, a missed event during a brief disconnect,
// or simply loading the page before the subscription finishes connecting all
// need a fallback that eventually self-corrects on its own.
const FALLBACK_POLL_MS = 5 * 60_000

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

  const refresh = React.useCallback(async () => {
    const res = await getAgentNotificationsAction()
    if (!res.error) setNotifications(res.notifications)
    setLoading(false)
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

    const fallbackPoll = setInterval(refresh, FALLBACK_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(fallbackPoll)
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
    <AgentNotificationsContext.Provider value={{ notifications, unreadCount, loading, refresh, markRead, markAllRead }}>
      {children}
    </AgentNotificationsContext.Provider>
  )
}

export function useAgentNotifications() {
  const ctx = React.useContext(AgentNotificationsContext)
  if (!ctx) throw new Error("useAgentNotifications must be used within AgentNotificationsProvider")
  return ctx
}
