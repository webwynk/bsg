"use client"

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bell, ShieldAlert, CheckCheck, RefreshCw } from 'lucide-react'
import { useAgentNotifications } from '@/components/agent-notifications-provider'

export default function AlertsPage() {
  const { notifications, unreadCount, loading, refresh, markRead, markAllRead } = useAgentNotifications()
  const [filter, setFilter] = React.useState<'all' | 'unread'>('all')
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    refresh().finally(() => setTimeout(() => setIsRefreshing(false), 400))
  }

  const filtered = filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications

  return (
    <div className="space-y-4 max-w-3xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-card border border-border/80 rounded-2xl shadow-xs">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground">Security Alerts</h1>
              {loading ? (
                <div className="h-5 w-14 bg-secondary/80 animate-pulse rounded-full" />
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-primary/10 text-primary border border-primary/20">
                  {notifications.length} Total
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs leading-tight hidden sm:block">
              Players auto-blocked after repeated failed login attempts.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {unreadCount > 0 && (
            <Button
              onClick={markAllRead}
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-none h-8 sm:h-9 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border"
            >
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
          <Button
            onClick={handleManualRefresh}
            variant="outline"
            size="sm"
            className="h-8 sm:h-9 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold cursor-pointer rounded-xl border-border"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center space-x-1.5 border-b border-border/80 pb-1">
        <button
          onClick={() => setFilter('all')}
          className={`px-3.5 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center space-x-2 ${
            filter === 'all'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          <span>All</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-background/20 font-mono">
            {notifications.length}
          </span>
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`px-3.5 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center space-x-2 ${
            filter === 'unread'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          <span>Unread</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-background/20 font-mono">
            {unreadCount}
          </span>
        </button>
      </div>

      {/* Alert list -- naturally responsive as a single-column list, no
          separate desktop/mobile layout needed (unlike History's wide table). */}
      <div className="space-y-2">
        {loading ? (
          [1, 2, 3].map(i => (
            <Card key={i} className="border-border/80 bg-card p-3 rounded-xl space-y-2 animate-pulse">
              <div className="h-3.5 bg-secondary/80 rounded w-3/4" />
              <div className="h-3 bg-secondary/60 rounded w-1/4" />
            </Card>
          ))
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-xs font-medium bg-card rounded-xl border border-border/80">
            {filter === 'unread' ? 'No unread alerts.' : 'No alerts yet.'}
          </div>
        ) : (
          filtered.map(n => (
            <Card
              key={n.id}
              onClick={() => !n.is_read && markRead(n.id)}
              className={`border-border/80 p-3 rounded-xl shadow-2xs transition-colors flex items-start gap-2.5 ${
                n.is_read ? 'bg-card opacity-70' : 'bg-red-500/5 border-red-500/20 cursor-pointer hover:bg-red-500/10'
              }`}
            >
              <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                n.is_read ? 'bg-secondary/60 text-muted-foreground' : 'bg-red-500/10 text-red-500 border border-red-500/20'
              }`}>
                <ShieldAlert className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground leading-snug">{n.message}</p>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{n.created_at_display}</p>
              </div>
              {!n.is_read && (
                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-1.5" aria-label="Unread" />
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
