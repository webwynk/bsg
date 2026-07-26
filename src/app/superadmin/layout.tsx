"use client"

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { LayoutDashboard, Users, LogOut, ShieldAlert } from 'lucide-react'

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname?.endsWith('/login')

  if (isLoginPage) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>
  }

  const isDashboardActive = pathname === '/superadmin' || pathname === '/superadmin/'
  const isAgentsActive = !!pathname?.startsWith('/superadmin/agents')

  const handleSignOut = () => {
    document.cookie = "mock_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;"
    window.location.href = '/superadmin/login'
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

        {/* Mobile Bottom Navigation Bar */}
        <nav className="flex md:hidden fixed bottom-0 left-0 right-0 h-16 bg-card/95 backdrop-blur-md border-t border-border z-20 items-center justify-around">
          <Link 
            href="/superadmin" 
            className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
              isDashboardActive ? 'text-primary font-extrabold' : 'text-muted-foreground'
            }`}
          >
            <LayoutDashboard className="h-5 w-5" />
            <span className="text-[10px] mt-1 tracking-wider uppercase font-bold">Overview</span>
          </Link>
          <Link 
            href="/superadmin/agents" 
            className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
              isAgentsActive ? 'text-primary font-extrabold' : 'text-muted-foreground'
            }`}
          >
            <Users className="h-5 w-5" />
            <span className="text-[10px] mt-1 tracking-wider uppercase font-bold">Agents</span>
          </Link>
        </nav>
      </div>
    </div>
  )
}
