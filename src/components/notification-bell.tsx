"use client"

import * as React from "react"
import { Bell } from "lucide-react"
import { getAgentNotificationsAction, markNotificationReadAction, type AgentNotification } from "@/app/agent/players/actions"

/**
 * Polls for security alerts (currently: players auto-blocked after 5 failed
 * login attempts) and shows them as a badge + dropdown. Polling rather than
 * Supabase Realtime for now -- simplest thing that gives agents a genuine
 * "someone got blocked" alert instead of a silent audit_log entry, matching
 * Option B's stated scope; a Realtime subscription is a drop-in upgrade
 * later if a few seconds of latency ever actually matters here.
 */
export function NotificationBell() {
  const [notifications, setNotifications] = React.useState<AgentNotification[]>([])
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const load = React.useCallback(async () => {
    const res = await getAgentNotificationsAction()
    if (!res.error) setNotifications(res.notifications)
  }, [])

  React.useEffect(() => {
    load()
    const interval = setInterval(load, 15_000)
    return () => clearInterval(interval)
  }, [load])

  React.useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  const unreadCount = notifications.filter(n => !n.is_read).length

  async function handleOpen() {
    setOpen(o => !o)
  }

  async function handleMarkRead(id: string) {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)))
    await markNotificationReadAction(id)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleOpen}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-secondary active:scale-95 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto rounded-xl border border-border bg-card shadow-2xl z-50">
          <div className="px-3 py-2 border-b border-border/60">
            <p className="text-xs font-extrabold text-foreground">Security Alerts</p>
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">No alerts.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {notifications.map(n => (
                <li
                  key={n.id}
                  onClick={() => !n.is_read && handleMarkRead(n.id)}
                  className={`px-3 py-2.5 text-xs cursor-pointer ${n.is_read ? "opacity-60" : "bg-red-500/5"}`}
                >
                  <p className="font-semibold text-foreground leading-snug">{n.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{n.created_at_display}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
