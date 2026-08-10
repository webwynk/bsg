"use client"

import { AlertsContent } from '@/components/alerts-content'

/**
 * Real, separate route inside the superadmin portal -- deliberately not just
 * a link to /agent/alerts. The two portals are strictly separated by
 * proxy.ts (formerly middleware.ts; a superadmin session is redirected away
 * from anything under /agent/*, no exceptions), so /agent/alerts was never
 * actually reachable from here even though the underlying data was already
 * correctly role-aware. Same shared content either way -- see
 * components/alerts-content.tsx.
 */
export default function SuperAdminAlertsPage() {
  return <AlertsContent />
}
