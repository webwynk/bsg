/**
 * True when a request is a Next.js Server Function (server action) call.
 *
 * Next.js sends every server action as a POST to the page's own URL with a
 * `next-action` header holding the action id (Next 16 docs, proxy.md: "They
 * are handled as POST requests to the route where they are used"). Page
 * opens, client-side navigations and prefetches are GET requests and never
 * carry this header.
 *
 * Used by src/proxy.ts to skip its own login/seat check on server actions
 * (2026-11-15, dashboard server-call optimisation step 1): every dashboard
 * server action already runs requireAuth() itself (Supabase Auth getUser +
 * staff_auth_check: profile, is_active, role and the single-device seat), so
 * the proxy's check on the same request was a duplicate. A request that only
 * pretends to be an action gains nothing: every dashboard page is a client
 * page with no data in it, and all data comes from actions that check auth
 * themselves.
 */
export function isServerActionRequest(method: string, headers: { has(name: string): boolean }): boolean {
  return method.toUpperCase() === 'POST' && headers.has('next-action')
}
