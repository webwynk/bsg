"use client"

import * as React from "react"
import { checkSessionAction, forceSignOutAction } from "@/app/actions/auth"

/**
 * Background poll so a device that has lost its single-device "seat" (or
 * been suspended while idle) finds out within 30s, from ANY page under the
 * portal -- not just whichever page happens to run its own data fetch next.
 * Mounted once per portal layout, same placement/pattern as
 * AgentNotificationsProvider (agent/layout.tsx, superadmin/layout.tsx).
 *
 * loginPath must match the portal this is mounted in ('/agent/login' or
 * '/superadmin/login') so the redirect lands on the right login screen.
 */
export function SessionGuardProvider({
  loginPath,
  children,
}: {
  loginPath: string
  children: React.ReactNode
}) {
  React.useEffect(() => {
    let cancelled = false
    // Requires TWO consecutive, independent 'superseded' results (30s apart)
    // before actually acting -- added after two separate live false-positive
    // incidents (a poller-collision case, then a Brave-Shields-on-a-missing-
    // cookie case) even after each was individually patched. A real
    // takeover stays superseded continuously, so this only costs one extra
    // 30s cycle of delay on a genuine case; a one-off inconsistency of any
    // kind, from any cause (including ones not yet seen), now has to happen
    // twice in a row to actually sign anyone out.
    let consecutiveSuperseded = 0

    const check = async () => {
      const res = await checkSessionAction()
      if (cancelled) return

      consecutiveSuperseded = res.status === 'superseded' ? consecutiveSuperseded + 1 : 0

      if (consecutiveSuperseded >= 2) {
        await forceSignOutAction(
          `${loginPath}?error=Signed in from another device. Please sign in again.`
        )
      }
    }

    const interval = setInterval(check, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [loginPath])

  return <>{children}</>
}
