import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'

/**
 * Staff keep-alive (2026-11-15, option A of "Block second login on
 * admin/agent accounts").
 *
 * Called every 30 s by <StaffSessionHeartbeat /> from every open agent and
 * superadmin tab, visible or hidden. requireAuth() runs staff_auth_check,
 * which refreshes active_sessions.last_seen_at ONLY when this browser's
 * bsg_staff_session cookie still matches the seat on file. So:
 *   - an open, signed-in tab keeps its seat for as long as it stays open;
 *   - once the tab is closed (or the PC sleeps / crashes) the beats stop and
 *     the seat frees itself after game_config.staff_session_grace_sec (180 s);
 *   - a tab that has already lost its seat never re-claims it here.
 *
 * Deliberately a route under /api, not a server action: src/proxy.ts skips
 * /api, so this request never runs the navigation gate that redirects a
 * superseded session to the login page. The keep-alive must only ever keep a
 * seat — it never signs anyone out or redirects. The caller ignores the
 * response; the status code is only there for debugging.
 */
export async function POST() {
  const auth = await requireAuth(['agent', 'superadmin'])
  return new NextResponse(null, {
    status: auth.error ? 401 : 204,
    headers: { 'Cache-Control': 'no-store' },
  })
}
