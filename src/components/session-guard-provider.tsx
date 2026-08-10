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

    const check = async () => {
      const res = await checkSessionAction()
      // 'unknown' (a transient hiccup checking, e.g. two background pollers
      // colliding on a token refresh) is deliberately ignored -- only a
      // clean, confirmed 'superseded' result forces a sign-out. See
      // checkSessionAction's comment for why this distinction is load-bearing.
      if (!cancelled && res.status === 'superseded') {
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
