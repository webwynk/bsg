"use client"

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bell, ShieldAlert, CheckCheck, RefreshCw, Clock, KeyRound, Check, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAgentNotifications } from '@/components/agent-notifications-provider'
import { ResetPasswordDialog } from '@/components/reset-password-dialog'
import { ResponsivePagination } from '@/components/responsive-pagination'

const ITEMS_PER_PAGE = 10

/**
 * Shared by both /agent/alerts and /superadmin/alerts -- same UI, but each
 * sees a deliberately different slice of the same data
 * (getAgentNotificationsAction): an agent sees only their own players'
 * lockout alerts, a superadmin sees only staff-lockout alerts (about an
 * agent/superadmin account itself) -- never an individual player's, which
 * stays with that player's own agent to handle.
 *
 * Pulled out of agent/alerts/page.tsx rather than duplicated, after
 * discovering the middleware strictly separates the two portals -- a
 * superadmin can never actually reach a route under /agent/*, so
 * /superadmin/alerts had to be a real, separate route, not just a link to
 * this one.
 */
export function AlertsContent() {
  const { notifications, unreadCount, loading, refresh, markRead, markAllRead } = useAgentNotifications()
  const [filter, setFilter] = React.useState<'all' | 'unread'>('all')
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [currentPage, setCurrentPage] = React.useState(1)

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    refresh().finally(() => setTimeout(() => setIsRefreshing(false), 400))
  }

  const filtered = filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1
  const safePage = Math.min(currentPage, totalPages)
  const paginated = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  return (
    <div className="space-y-4 max-w-3xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-card/90 backdrop-blur-md border border-border/80 rounded-2xl shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0 shadow-inner">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground">Security Alerts</h1>
              {loading ? (
                <div className="h-5 w-14 bg-secondary/80 animate-pulse rounded-full" />
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-primary/10 text-primary border border-primary/20">
                  {notifications.length} Total
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs leading-tight hidden sm:block mt-0.5">
              Players and staff accounts auto-blocked after repeated failed login attempts.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {unreadCount > 0 && (
            <Button
              onClick={markAllRead}
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-none h-8 sm:h-9 px-3 text-[11px] sm:text-xs font-extrabold cursor-pointer rounded-xl border-border hover:bg-secondary/60 transition-all"
            >
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
          <Button
            onClick={handleManualRefresh}
            variant="outline"
            size="sm"
            className="h-8 sm:h-9 px-3 text-[11px] sm:text-xs font-extrabold cursor-pointer rounded-xl border-border hover:bg-secondary/60 transition-all"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center space-x-2 border-b border-border/80 pb-1.5">
        <button
          onClick={() => { setFilter('all'); setCurrentPage(1) }}
          className={`px-4 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center space-x-2 ${
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
          onClick={() => { setFilter('unread'); setCurrentPage(1) }}
          className={`px-4 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center space-x-2 ${
            filter === 'unread'
              ? 'bg-rose-500 text-white shadow-xs shadow-rose-950/40'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          <span>Unread</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/30 font-mono text-white">
            {unreadCount}
          </span>
        </button>
      </div>

      {/* Alert Cards Container */}
      <div className="space-y-3">
        {loading ? (
          [1, 2, 3].map(i => (
            <Card key={i} className="border-border/80 bg-card p-0 rounded-2xl overflow-hidden animate-pulse">
              <div className="p-4 space-y-2">
                <div className="h-4 bg-secondary/80 rounded w-3/4" />
                <div className="h-3 bg-secondary/60 rounded w-1/4" />
              </div>
            </Card>
          ))
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center bg-card/60 backdrop-blur-md rounded-2xl border border-border/80">
            <Bell className="h-9 w-9 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-muted-foreground text-xs font-semibold">
              {filter === 'unread' ? 'No unread security alerts.' : 'No alerts recorded yet.'}
            </p>
          </div>
        ) : (
          paginated.map(n => {
            const isUnread = !n.is_read

            return (
              <Card
                key={n.id}
                className={`p-0 rounded-2xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl flex flex-col sm:flex-row ${
                  isUnread
                    ? 'bg-gradient-to-r from-rose-950/40 via-slate-900/95 to-slate-950/95 border border-rose-500/30 shadow-md shadow-rose-950/30'
                    : 'bg-slate-900/40 border border-slate-800/70 opacity-85 hover:opacity-100'
                }`}
              >
                {/* Accent Bar */}
                <div
                  className={`h-1 sm:h-auto sm:w-1.5 shrink-0 ${
                    isUnread
                      ? 'bg-gradient-to-r sm:bg-gradient-to-b from-rose-500 to-amber-500'
                      : 'bg-slate-700/50'
                  }`}
                />

                <div className="flex-1 p-3.5 sm:p-4 space-y-3">
                  {/* Card Header: Icon, Message & Status Badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start space-x-3 min-w-0 flex-1">
                      <div
                        className={`p-2 rounded-xl shrink-0 ${
                          isUnread
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-xs'
                            : 'bg-secondary/60 text-muted-foreground border border-border/40'
                        }`}
                      >
                        {isUnread ? (
                          <AlertTriangle className="h-4 w-4 text-rose-400" />
                        ) : (
                          <ShieldAlert className="h-4 w-4" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <p
                          className={`text-xs sm:text-sm leading-snug break-words ${
                            isUnread
                              ? 'font-bold text-slate-100 tracking-tight'
                              : 'font-medium text-slate-300'
                          }`}
                        >
                          {n.message}
                        </p>

                        <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 font-mono">
                          <Clock className="h-3 w-3 text-slate-500 shrink-0" />
                          <span>{n.created_at_display}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status Pill Badge */}
                    <div className="shrink-0 flex items-center">
                      {isUnread ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase tracking-wider">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                          Unread
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800/80 text-slate-400 border border-slate-700/50 uppercase tracking-wider">
                          Read
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Actions Row: Responsive Mobile & Desktop Layout */}
                  <div className="pt-2 border-t border-border/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {n.player_id && n.player_still_locked && (
                        <ResetPasswordDialog
                          playerId={n.player_id}
                          playerName={n.player_full_name ?? n.player_username ?? 'this player'}
                          playerUsername={n.player_username ?? ''}
                          onSuccess={async () => {
                            if (!n.is_read) await markRead(n.id)
                            await refresh()
                          }}
                          trigger={
                            <button className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer text-xs font-black shadow-xs transition-all w-full sm:w-auto">
                              <KeyRound className="h-3.5 w-3.5" /> Reset Password
                            </button>
                          }
                        />
                      )}

                      {n.player_id && !n.player_still_locked && (
                        <span className="inline-flex items-center justify-center gap-1.5 h-7 px-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-extrabold w-full sm:w-auto">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Unlocked & Active
                        </span>
                      )}
                    </div>

                    {/* Mark Read Action Button */}
                    {isUnread && (
                      <button
                        onClick={() => markRead(n.id)}
                        className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-xl border border-border/80 text-slate-300 hover:text-white hover:bg-secondary/60 cursor-pointer text-xs font-extrabold transition-all w-full sm:w-auto ml-auto"
                      >
                        <Check className="h-3.5 w-3.5" /> Mark as Read
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {!loading && filtered.length > ITEMS_PER_PAGE && (
        <ResponsivePagination
          currentPage={safePage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filtered.length}
          itemsPerPage={ITEMS_PER_PAGE}
        />
      )}
    </div>
  )
}
