import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { STAFF_SESSION_COOKIE } from '@/lib/staff-session'
import { asRpc, type StaffSessionTouchResult } from '@/lib/rpc'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const { pathname } = request.nextUrl

  // Redirect root to agent login
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/agent/login', request.url))
  }

  // Exclude login pages, _next internal routes, api routes, and static asset extensions
  const isStaticFile = /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff|woff2|ttf|eot|map|json)$/i.test(pathname)
  if (pathname.includes('/login') || pathname.startsWith('/_next') || pathname.startsWith('/api') || isStaticFile) {
    return response
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return response
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

  const { data: { user } } = await supabase.auth.getUser()

  // S-2 FIX: read the role from `app_metadata`, never `user_metadata`.
  //
  // In Supabase, user_metadata (raw_user_meta_data) is SELF-SERVICE WRITABLE —
  // any authenticated user can call
  //     supabase.auth.updateUser({ data: { role: 'superadmin' } })
  // with their own token. Reading the role from there meant a player could
  // promote themselves and walk into every /superadmin route.
  //
  // app_metadata (raw_app_meta_data) can only be written with the service role.
  // It is kept in step with profiles.role by a database trigger, so it is safe
  // to trust here and costs no database round trip on each navigation.
  //
  // This guard covers page routes only. Server actions independently re-verify
  // through requireAuth(), which reads public.profiles directly.
  const userRole = user?.app_metadata?.role

  // Protect /superadmin routes
  if (pathname.startsWith('/superadmin')) {
    if (!user) {
      return NextResponse.redirect(new URL('/superadmin/login', request.url))
    }
    // Strict RBAC: If logged-in user is NOT a SuperAdmin
    if (userRole && userRole !== 'superadmin') {
      if (userRole === 'agent') {
        return NextResponse.redirect(new URL('/agent', request.url))
      }
      return NextResponse.redirect(new URL('/superadmin/login', request.url))
    }
  }

  // Protect /agent routes
  if (pathname.startsWith('/agent')) {
    if (!user) {
      return NextResponse.redirect(new URL('/agent/login', request.url))
    }
    // Strict RBAC: If logged-in user is a SuperAdmin, redirect to /superadmin
    if (userRole === 'superadmin') {
      return NextResponse.redirect(new URL('/superadmin', request.url))
    }
    // Strict RBAC: If logged-in user is a Player, redirect to agent login
    if (userRole === 'player') {
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
  // still valid" -- this middleware's existing getUser() check, and the
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
