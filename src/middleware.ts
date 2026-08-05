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

  // Allow login pages, static assets, and API routes to proceed
  if (pathname.includes('/login') || pathname.startsWith('/_next') || pathname.includes('.')) {
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
  const mockSession = request.cookies.get('mock_session')?.value

  // Extract user role from JWT user metadata or fallback cookie
  const userRole = user?.user_metadata?.role || mockSession

  // Protect /superadmin routes
  if (pathname.startsWith('/superadmin')) {
    if (!user && mockSession !== 'superadmin') {
      return NextResponse.redirect(new URL('/superadmin/login', request.url))
    }
    // Strict RBAC: If logged-in user is NOT a SuperAdmin (e.g., Agent or Player)
    if (userRole && userRole !== 'superadmin') {
      if (userRole === 'agent') {
        return NextResponse.redirect(new URL('/agent', request.url))
      }
      return NextResponse.redirect(new URL('/superadmin/login', request.url))
    }
  }

  // Protect /agent routes
  if (pathname.startsWith('/agent')) {
    if (!user && mockSession !== 'agent') {
      return NextResponse.redirect(new URL('/agent/login', request.url))
    }
    // Strict RBAC: If logged-in user is a SuperAdmin, redirect to /superadmin (never open Agent Dashboard)
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
