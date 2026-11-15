"use client"

import { useEffect } from 'react'

/** How often an open staff tab tells the server "still here". 30 s = six
 * beats inside the 180 s staff_session_grace_sec, so one or two slow or
 * dropped beats (or a browser slowing hidden-tab timers to once a minute)
 * never free the seat by mistake. */
const HEARTBEAT_MS = 30_000

/**
 * Background keep-alive for the agent and superadmin portals (2026-11-15,
 * option A of "Block second login on admin/agent accounts"). Renders nothing.
 *
 * Unlike the data polls (useLiveSync), this keeps running while the tab is
 * hidden: a minimised dashboard is still "in use" and must keep its seat so a
 * second login stays refused. It also beats once on mount and again when the
 * tab becomes visible, to catch up after a phone or laptop wakes.
 *
 * Fire-and-forget by design: every response and every network error is
 * ignored. A failed beat must never sign anyone out — the only effect of
 * missing beats is that the seat frees itself after 3 minutes. Sign-outs for a
 * genuinely superseded session stay where they were (src/proxy.ts and
 * requireAuth()).
 */
export function StaffSessionHeartbeat() {
  useEffect(() => {
    let inFlight = false

    const beat = () => {
      if (inFlight) return
      inFlight = true
      fetch('/api/staff-heartbeat', { method: 'POST', cache: 'no-store', keepalive: true })
        .catch(() => { /* ignored on purpose, see above */ })
        .finally(() => { inFlight = false })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') beat()
    }

    beat()
    const intervalId = setInterval(beat, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return null
}
