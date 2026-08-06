import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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

  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}
