import { createServerClient } from '@supabase/ssr'
import type { JwtPayload } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { STAFF_SESSION_COOKIE } from '@/lib/staff-session'
import { asRpc, type StaffSessionTouchResult } from '@/lib/rpc'
import { isServerActionRequest } from '@/lib/server-action-request'

// Renamed from middleware.ts (Next.js 16 deprecated the `middleware` file
// convention in favor of `proxy` -- same behavior, same config.matcher
// syntax, just a different file name and exported function name). Runs on
// the Node.js runtime now instead of Edge (proxy doesn't support Edge);
// nothing here used any Edge-only API, so this is a straight rename with no
// behavior change.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const { pathname } = request.nextUrl

  // Exclude login pages, _next internal routes, api routes, and static asset extensions
  const isStaticFile = /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff|woff2|ttf|eot|map|json)$/i.test(pathname)
  if (pathname.includes('/login') || pathname.startsWith('/_next') || pathname.startsWith('/api') || isStaticFile) {
    return response
  }

  // Server actions (every dashboard data refresh, and every button that saves
  // something) are POSTs to the page's own URL with a `next-action` header.
  // Each one already runs requireAuth() itself -- the signed-in check
  // (getClaims since 2026-11-19, getUser before) plus staff_auth_check
  // (profile, is_active, role, single-device seat, and the seat's
  // last_seen_at refresh) -- so running this proxy's login check +
  // staff_session_touch on the same request only doubled the work
  // (2026-11-15, dashboard server-call optimisation step 1: 4 login/session
  // steps per refresh -> 2). Page opens and client-side navigations are GETs
  // and still go through every check below, including the "signed in from
  // another device" redirect. A superseded tab's background refreshes get
  // requireAuth()'s "signed in from another device" error instead (Next.js
  // never turned this proxy's redirect into a page change for an action
  // request anyway -- only a redirect() inside the action does that).
  if (isServerActionRequest(request.method, request.headers)) {
    return response
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Issue #18 FIX: this used to `return response` here -- passing every
  // request through with no auth/role check at all -- whenever Supabase env
  // vars were missing, while requireAuth() (the guard on every actual
  // mutating action) correctly fails closed on the identical condition. A
  // misconfigured deploy would render the admin/agent page shell to anyone
  // while the data underneath stayed protected -- internally inconsistent.
  // Now mirrors the same per-section redirect every other guard below
  // already uses for "no user determined": superadmin paths go to the
  // superadmin login, everything else defaults to agent login (matching the
  // root-path handler's own fallback at line ~90).
  if (!supabaseUrl || !supabaseKey) {
    const loginPath = pathname.startsWith('/superadmin') ? '/superadmin/login' : '/agent/login'
    return NextResponse.redirect(new URL(loginPath, request.url))
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Who is signed in, checked locally (2026-11-19, speed plan phase 2).
  //
  // getClaims() verifies the access token's signature right here with the
  // project's public ECC (P-256) signing key, fetched once from Supabase's
  // JWKS endpoint and cached in memory for 10 minutes -- no call to the
  // Supabase Auth server on each page open, which getUser() used to make.
  // Like getUser(), it first reads the session from the cookies and refreshes
  // an expired access token (the refreshed cookies are written by setAll
  // above). It only falls back to calling the Auth server for a token signed
  // with the old HS256 secret.
  //
  // What this does NOT check any more on page opens: whether the Auth user was
  // deleted/banned since the token was issued (tokens last up to 1 hour). That
  // is still enforced immediately because (a) staff pages run the
  // staff_session_touch seat check below, and (b) every server action -- all
  // the data on every page -- runs requireAuth(), whose staff_auth_check reads
  // the profile's is_active, role and single-login seat fresh from the
  // database. A failed check (bad signature, no session, network error
  // fetching the key) counts as "not signed in": fail closed to the login
  // page, exactly as a failed getUser() did.
  let claims: JwtPayload | null = null
  try {
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
    if (!claimsError && claimsData?.claims?.sub) claims = claimsData.claims
  } catch {
    claims = null
  }

  // S-2 FIX: read the role from `app_metadata`, never `user_metadata`.
  //
  // In Supabase, user_metadata (raw_user_meta_data) is SELF-SERVICE WRITABLE —
  // any authenticated user can call
  //     supabase.auth.updateUser({ data: { role: 'superadmin' } })
  // with their own token. Reading the role from there meant a player could
  // promote themselves and walk into every /superadmin route.
  //
  // app_metadata (raw_app_meta_data) can only be written with the service role.
  // It is kept in step with profiles.role by a database trigger, and copied
  // into the signed access token, so it is safe to trust here and costs no
  // round trip. Since getClaims() reads it from the token, a role change shows
  // here only once the token is refreshed (at most ~1 hour).
  //
  // This guard covers page routes only. Server actions independently re-verify
  // through requireAuth(), which reads public.profiles directly.
  const userRole = claims?.app_metadata?.role

  // Redirect root to whoever's actual portal, not unconditionally to agent
  // login. Previously this ran BEFORE user/role were even known (the very
  // first check in the file), so an already-logged-in agent or superadmin
  // opening a new tab and visiting the bare root got bounced to a login
  // screen while their real session sat untouched -- confusing, and on the
  // staff portals specifically could make someone think they'd been signed
  // out and try logging in again, only to be refused "already logged in
  // elsewhere" by their own first tab. Moved here, after user/role are
  // resolved, so it can send each role to where it actually belongs. Every
  // branch still redirects somewhere (never falls through to render
  // anything) -- src/app/page.tsx (the unmodified create-next-app starter
  // page, already documented in MASTER_AUDIT_AND_REMEDIATION_PLAN.md as
  // provably unreachable because of this exact redirect) stays unreachable.
  if (pathname === '/') {
    if (userRole === 'superadmin') {
      return NextResponse.redirect(new URL('/superadmin', request.url))
    }
    if (userRole === 'agent') {
      return NextResponse.redirect(new URL('/agent', request.url))
    }
    return NextResponse.redirect(new URL('/agent/login', request.url))
  }

  // Protect /superadmin routes
  if (pathname.startsWith('/superadmin')) {
    if (!claims) {
      return NextResponse.redirect(new URL('/superadmin/login', request.url))
    }
    // Strict RBAC, explicit allow-list -- fails closed on a missing/falsy
    // role too. MASTER_AUDIT_AND_REMEDIATION_PLAN.md Issue #17: the
    // previous `userRole && userRole !== 'superadmin'` skipped this whole
    // check when userRole was falsy (e.g. app_metadata not yet synced),
    // default-ALLOWING an unverified role through to the page shell instead
    // of failing closed. requireAuth() was always the real backstop for
    // actual data/actions, so this was defense-in-depth, not a live
    // exploit -- but a page shell with no confirmed role shouldn't have
    // been reachable at all.
    if (userRole !== 'superadmin') {
      if (userRole === 'agent') {
        return NextResponse.redirect(new URL('/agent', request.url))
      }
      return NextResponse.redirect(new URL('/superadmin/login', request.url))
    }
  }

  // Protect /agent routes
  if (pathname.startsWith('/agent')) {
    if (!claims) {
      return NextResponse.redirect(new URL('/agent/login', request.url))
    }
    // Strict RBAC: If logged-in user is a SuperAdmin, redirect to /superadmin
    if (userRole === 'superadmin') {
      return NextResponse.redirect(new URL('/superadmin', request.url))
    }
    // Explicit allow-list from here on (Issue #17): previously an explicit
    // deny-list of just 'superadmin'/'player', default-ALLOWING any other
    // falsy/unrecognized role through. Now anything that isn't 'agent'
    // (player, missing role, anything else) fails closed.
    if (userRole !== 'agent') {
      return NextResponse.redirect(new URL('/agent/login', request.url))
    }
  }

  // Single-device enforcement for staff (agent/superadmin) portals. Runs
  // once, here, as part of the SAME request already checking login/role
  // above -- deliberately NOT a separate client-side timer.
  //
  // History: single-device was first enforced via a client-side poll
  // (SessionGuardProvider, since removed) running independently every 30s.
  // That created two uncoordinated systems both checking "is this session
  // still valid" -- this file's existing login check, and the
  // separate poll -- which raced against each other and against normal page
  // data-fetches, producing repeated, confirmed-live false "signed in from
  // another device" kicks on a perfectly valid session. Moved into the one
  // gate that was already proven reliable (this file's existing checks)
  // instead of running a second, independent one alongside it.
  if (
    (pathname.startsWith('/superadmin') || pathname.startsWith('/agent')) &&
    (userRole === 'agent' || userRole === 'superadmin')
  ) {
    const loginPath = userRole === 'superadmin' ? '/superadmin/login' : '/agent/login'
    const sessionToken = request.cookies.get(STAFF_SESSION_COOKIE)?.value

    // Missing cookie is unambiguous (nothing to be superseded from) and
    // redirects immediately below. A present cookie needs a genuine,
    // completed answer from the RPC before concluding "superseded" --
    // if the call itself errors (network/transient), that's inconclusive,
    // NOT confirmation of a takeover. Blocking on an inconclusive result
    // here was the exact same false-positive class already fixed twice for
    // the old client-side poll; requireAuth() remains the real, unaffected
    // backstop on every actual action regardless of what this navigation
    // guard concludes, so failing open on a genuine RPC error costs nothing
    // security-wise -- it only means this one navigation isn't the moment
    // a real supersession gets caught, not that it never will be.
    let sessionValid = !sessionToken ? false : null
    if (sessionToken) {
      const { data: touchData, error: touchError } = await supabase.rpc('staff_session_touch', {
        p_session_token: sessionToken,
      })
      if (!touchError) {
        const touchResult = touchData ? asRpc<StaffSessionTouchResult>(touchData) : null
        sessionValid = touchResult?.valid === true
      }
    }

    if (sessionValid === false) {
      const redirectResponse = NextResponse.redirect(
        new URL(`${loginPath}?error=Signed in from another device. Please sign in again.`, request.url)
      )
      redirectResponse.cookies.delete(STAFF_SESSION_COOKIE)
      return redirectResponse
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}
