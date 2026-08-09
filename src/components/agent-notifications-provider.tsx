"use client"

import * as React from "react"
import { getAgentNotificationsAction, markNotificationReadAction, type AgentNotification } from "@/app/agent/players/actions"

interface AgentNotificationsContextValue {
  notifications: AgentNotification[]
  unreadCount: number
  loading: boolean
  refresh: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const AgentNotificationsContext = React.createContext<AgentNotificationsContextValue | null>(null)

/**
 * Single source of truth for agent security alerts, polled once here rather
 * than separately by the nav badge and the /agent/alerts page -- both read
 * this same context, so there is exactly one 15s poll running regardless of
 * how many places display the data.
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
    refresh()
    const interval = setInterval(refresh, 15_000)
    return () => clearInterval(interval)
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
