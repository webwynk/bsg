"use client"

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { LayoutDashboard, Users, LogOut, ShieldAlert, Radio, Bell } from 'lucide-react'
import { AgentNotificationsProvider, useAgentNotifications } from '@/components/agent-notifications-provider'
import { LiveDataProvider } from '@/components/live-data-provider'

/** Same treatment as the agent portal's identical badge -- kept as a
 * separate copy rather than a shared import since it's a 6-line component
 * and importing across portal boundaries for something this small isn't
 * worth the coupling. */
function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white leading-none">
      {count > 9 ? '9+' : count}
    </span>
  )
}

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname?.endsWith('/login')

  if (isLoginPage) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>
  }

  return (
    <LiveDataProvider>
      <AgentNotificationsProvider>
        <SuperAdminLayoutShell pathname={pathname}>{children}</SuperAdminLayoutShell>
      </AgentNotificationsProvider>
    </LiveDataProvider>
  )
}

function SuperAdminLayoutShell({ pathname, children }: { pathname: string | null; children: ReactNode }) {
  const { unreadCount } = useAgentNotifications()

  const isDashboardActive = pathname === '/superadmin' || pathname === '/superadmin/'
  const isLiveGameActive = !!pathname?.startsWith('/superadmin/live-game')
  const isAgentsActive = !!pathname?.startsWith('/superadmin/agents')
  // /superadmin/alerts, NOT /agent/alerts -- proxy.ts (formerly middleware.ts)
  // strictly redirects any superadmin session away from /agent/*, so linking to /agent/alerts
  // never actually worked. Both routes share the same content component
  // (components/alerts-content.tsx) over the same role-aware data
  // (getAgentNotificationsAction scopes a superadmin caller to agent_id IS
  // NULL rows only -- staff-lockout broadcasts -- deliberately excluding
  // individual player lockouts, which stay with that player's own agent).
  const isAlertsActive = !!pathname?.startsWith('/superadmin/alerts')

  const handleSignOut = async () => {
    const { signOutAction } = await import('@/app/actions/auth')
    await signOutAction('/superadmin/login')
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Desktop Sidebar (Compact w-52) */}
      <aside className="hidden md:flex w-52 border-r border-border bg-card flex-col shrink-0">
        <div className="p-4 flex items-center justify-between border-b border-border/50">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-foreground leading-tight">God Mode</h2>
              <p className="text-[10px] text-muted-foreground font-semibold">Super Admin</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
        <nav className="flex-1 p-2 space-y-1">
          <Link 
            href="/superadmin" 
            className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl transition-all text-xs font-bold ${
              isDashboardActive 
                ? 'bg-primary text-primary-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            <span>Dashboard</span>
          </Link>

          <Link 
            href="/superadmin/live-game" 
            className={`flex items-center justify-between px-3 py-2 rounded-xl transition-all text-xs font-bold ${
              isLiveGameActive 
                ? 'bg-primary text-primary-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Radio className="h-4 w-4 shrink-0" />
              <span>Live Monitor</span>
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-xs shrink-0" />
          </Link>

          <Link 
            href="/superadmin/agents" 
            className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl transition-all text-xs font-bold ${
              isAgentsActive 
                ? 'bg-primary text-primary-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            <Users className="h-4 w-4 shrink-0" />
            <span>Agents</span>
          </Link>

          <Link
            href="/superadmin/alerts"
            className={`relative flex items-center space-x-2.5 px-3 py-2 rounded-xl transition-all text-xs font-bold ${
              isAlertsActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            <span className="relative shrink-0">
              <Bell className="h-4 w-4" />
              <UnreadBadge count={unreadCount} />
            </span>
            <span>Alerts</span>
          </Link>
        </nav>
        <div className="p-3 border-t border-border/60">
          <button 
            onClick={handleSignOut} 
            className="w-full flex items-center space-x-2 px-3 py-2 text-xs text-red-500 hover:bg-red-500/10 rounded-xl transition-colors font-extrabold cursor-pointer text-left"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Mobile Header Bar */}
        <header className="flex md:hidden items-center justify-between h-14 px-4 bg-card border-b border-border z-20 shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold tracking-tight">God Mode</h2>
              <p className="text-[10px] text-muted-foreground">Super Admin</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <ThemeToggle />
            <button 
              onClick={handleSignOut}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-red-500 hover:bg-red-500/10 cursor-pointer"
              aria-label="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Main Content Pane */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-5 md:p-6 bg-background pb-20 md:pb-6">
          {children}
        </main>

        {/* Mobile Bottom Navigation Bar (Modern Floating Glassmorphic Design) */}
        <nav className="flex md:hidden fixed bottom-2.5 left-3 right-3 h-14 bg-card/90 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl z-30 items-center justify-around px-1.5">
          <Link 
            href="/superadmin" 
            className={`relative flex flex-col items-center justify-center flex-1 h-11 mx-0.5 rounded-xl transition-all duration-300 cursor-pointer ${
              isDashboardActive 
                ? 'bg-primary/15 text-primary border border-primary/25 shadow-xs font-black' 
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 font-semibold'
            }`}
          >
            {isDashboardActive && (
              <span className="absolute -top-1 w-3 h-1 rounded-full bg-primary animate-pulse shadow-xs" />
            )}
            <LayoutDashboard className={`h-4 w-4 transition-transform duration-300 ${isDashboardActive ? 'scale-110 stroke-[2.5]' : 'stroke-[1.8]'}`} />
            <span className={`text-[9px] mt-0.5 tracking-wider uppercase ${isDashboardActive ? 'font-black text-primary' : 'font-bold'}`}>
              Overview
            </span>
          </Link>

          <Link 
            href="/superadmin/live-game" 
            className={`relative flex flex-col items-center justify-center flex-1 h-11 mx-0.5 rounded-xl transition-all duration-300 cursor-pointer ${
              isLiveGameActive 
                ? 'bg-primary/15 text-primary border border-primary/25 shadow-xs font-black' 
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 font-semibold'
            }`}
          >
            {isLiveGameActive && (
              <span className="absolute -top-1 w-3 h-1 rounded-full bg-primary animate-pulse shadow-xs" />
            )}
            <Radio className={`h-4 w-4 transition-transform duration-300 ${isLiveGameActive ? 'scale-110 stroke-[2.5]' : 'stroke-[1.8]'}`} />
            <span className={`text-[9px] mt-0.5 tracking-wider uppercase ${isLiveGameActive ? 'font-black text-primary' : 'font-bold'}`}>
              Live Draw
            </span>
          </Link>

          <Link 
            href="/superadmin/agents" 
            className={`relative flex flex-col items-center justify-center flex-1 h-11 mx-0.5 rounded-xl transition-all duration-300 cursor-pointer ${
              isAgentsActive 
                ? 'bg-primary/15 text-primary border border-primary/25 shadow-xs font-black' 
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 font-semibold'
            }`}
          >
            {isAgentsActive && (
              <span className="absolute -top-1 w-3 h-1 rounded-full bg-primary animate-pulse shadow-xs" />
            )}
            <Users className={`h-4 w-4 transition-transform duration-300 ${isAgentsActive ? 'scale-110 stroke-[2.5]' : 'stroke-[1.8]'}`} />
            <span className={`text-[9px] mt-0.5 tracking-wider uppercase ${isAgentsActive ? 'font-black text-primary' : 'font-bold'}`}>
              Agents
            </span>
          </Link>

          <Link
            href="/superadmin/alerts"
            className={`relative flex flex-col items-center justify-center flex-1 h-11 mx-0.5 rounded-xl transition-all duration-300 cursor-pointer ${
              isAlertsActive
                ? 'bg-primary/15 text-primary border border-primary/25 shadow-xs font-black'
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 font-semibold'
            }`}
          >
            {isAlertsActive && (
              <span className="absolute -top-1 w-3 h-1 rounded-full bg-primary animate-pulse shadow-xs" />
            )}
            <span className="relative">
              <Bell className={`h-4 w-4 transition-transform duration-300 ${isAlertsActive ? 'scale-110 stroke-[2.5]' : 'stroke-[1.8]'}`} />
              <UnreadBadge count={unreadCount} />
            </span>
            <span className={`text-[9px] mt-0.5 tracking-wider uppercase ${isAlertsActive ? 'font-black text-primary' : 'font-bold'}`}>
              Alerts
            </span>
          </Link>
        </nav>
      </div>
    </div>
  )
}
