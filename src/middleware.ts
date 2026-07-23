import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Temporary Dev Bypass: Check for a mock session cookie
  const session = request.cookies.get('mock_session')?.value
  const { pathname } = request.nextUrl

  // Protect /superadmin routes
  if (pathname.startsWith('/superadmin') && !pathname.includes('/login')) {
    if (session !== 'superadmin') {
      return NextResponse.redirect(new URL('/superadmin/login', request.url))
    }
  }

  // Protect /agent routes
  if (pathname.startsWith('/agent') && !pathname.includes('/login')) {
    if (session !== 'agent' && session !== 'superadmin') {
      return NextResponse.redirect(new URL('/agent/login', request.url))
    }
  }

  // Redirect root to agent login by default
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/agent/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}
