"use client"

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bell, ShieldAlert, CheckCheck, RefreshCw, Clock, KeyRound, Check } from 'lucide-react'
import { useAgentNotifications } from '@/components/agent-notifications-provider'
import { ResetPasswordDialog } from '@/components/reset-password-dialog'

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
      <div className="space-y-2.5">
        {loading ? (
          [1, 2, 3].map(i => (
            <Card key={i} className="border-border/80 bg-card p-0 rounded-2xl overflow-hidden animate-pulse">
              <div className="p-3.5 space-y-2">
                <div className="h-3.5 bg-secondary/80 rounded w-3/4" />
                <div className="h-3 bg-secondary/60 rounded w-1/4" />
              </div>
            </Card>
          ))
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center bg-card rounded-2xl border border-border/80">
            <Bell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-muted-foreground text-xs font-medium">
              {filter === 'unread' ? 'No unread alerts.' : 'No alerts yet.'}
            </p>
          </div>
        ) : (
          filtered.map(n => (
            <Card
              key={n.id}
              className={`border-border/80 p-0 rounded-2xl shadow-2xs overflow-hidden flex ${
                n.is_read ? 'bg-card' : 'bg-red-500/[0.03]'
              }`}
            >
              {/* Left accent bar -- the "this needs attention" signal, modern
                  notification-card convention instead of a flat background tint. */}
              <div className={`w-1 shrink-0 ${n.is_read ? 'bg-border/60' : 'bg-red-500'}`} />

              <div className="flex-1 min-w-0 p-3 sm:p-3.5 space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <div className={`p-1.5 rounded-lg shrink-0 ${
                    n.is_read ? 'bg-secondary/60 text-muted-foreground' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                  }`}>
                    <ShieldAlert className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs sm:text-[13px] leading-snug ${n.is_read ? 'font-medium text-foreground/80' : 'font-bold text-foreground'}`}>
                      {n.message}
                    </p>
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span className="font-mono">{n.created_at_display}</span>
                    </div>
                  </div>
                  {!n.is_read && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black bg-red-500/10 text-red-500 border border-red-500/20 shrink-0">
                      NEW
                    </span>
                  )}
                </div>

                {/* Action row -- responsive: wraps naturally on narrow mobile
                    instead of overflowing. */}
                <div className="flex flex-wrap items-center gap-2">
                  {n.player_id && (
                    <ResetPasswordDialog
                      playerId={n.player_id}
                      playerName={n.player_full_name ?? n.player_username ?? 'this player'}
                      playerUsername={n.player_username ?? ''}
                      onSuccess={() => !n.is_read && markRead(n.id)}
                      trigger={
                        <button className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 cursor-pointer text-[11px] font-bold">
                          <KeyRound className="h-3 w-3" /> Reset Password
                        </button>
                      }
                    />
                  )}
                  {!n.is_read && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 cursor-pointer text-[11px] font-bold"
                    >
                      <Check className="h-3 w-3" /> Mark read
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
