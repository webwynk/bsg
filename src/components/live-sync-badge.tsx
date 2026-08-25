"use client"

import * as React from "react"

/**
 * Honest replacement for the old inline "Live Sync" badge that every route
 * used to render for itself, driven purely by the Realtime channel's own
 * connection flag. Issue #91's investigation proved that flag can report
 * "connected" for an entire session while every actual event silently fails
 * a server-side authorization check, with zero client-visible signal --
 * showing green off that flag alone was actively misleading.
 *
 * This shows how long ago data was actually last synced instead, driven by
 * useLiveSync's lastSyncedAt (which advances on its own guaranteed poll
 * regardless of Realtime's state) and degrades to an amber "stale" look if
 * that ever falls behind its expected freshness window -- e.g. a
 * backgrounded/suspended tab, or some future failure mode nobody has hit
 * yet. It is deliberately not a static "we are live" claim.
 */
export function LiveSyncBadge({
  lastSyncedAt,
  tierMs,
}: {
  lastSyncedAt: number | null
  tierMs: number
}) {
  // Ticks once a second purely to keep the relative "Xs ago" text (and the
  // fresh/stale color it drives) current -- lastSyncedAt itself only
  // actually changes when a real sync happens. `now` is read during render
  // but only ever written from inside the effect below, never computed via
  // a direct Date.now() call in the render body itself -- react-compiler
  // treats Date.now() as an impure call and forbids it during render.
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    // Wrapped in an async IIFE, not called directly at the top of the
    // effect body -- same react-hooks/set-state-in-effect fix already
    // established in agent-notifications-provider.tsx and use-live-sync.ts.
    ;(async () => {
      setNow(Date.now())
    })()
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  const ageMs = lastSyncedAt === null || now === null ? null : now - lastSyncedAt
  // Stale threshold is 2x the poll interval, not 1x -- a sync landing just
  // after a tick boundary is still well within normal operation, not a
  // fault. Past 2x the interval, the poll itself has missed at least one
  // scheduled run, which is worth surfacing rather than staying silently
  // "fresh" forever.
  const isStale = ageMs !== null && ageMs > tierMs * 2

  const label = React.useMemo(() => {
    if (ageMs === null) return "Connecting…"
    const seconds = Math.max(0, Math.round(ageMs / 1000))
    if (seconds < 2) return "Synced just now"
    if (seconds < 60) return `Synced ${seconds}s ago`
    const minutes = Math.round(seconds / 60)
    return `Synced ${minutes}m ago`
  }, [ageMs])

  const tone =
    ageMs === null
      ? "bg-secondary/40 text-muted-foreground border-border/60"
      : isStale
        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"

  const dotTone =
    ageMs === null
      ? "bg-muted-foreground/60"
      : isStale
        ? "bg-amber-400"
        : "bg-emerald-400 animate-pulse"

  return (
    <span
      className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-xl border ${tone}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotTone}`} />
      {label}
    </span>
  )
}
