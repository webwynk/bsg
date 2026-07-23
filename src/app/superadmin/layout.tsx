"use client"

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { LayoutDashboard, Users, LogOut } from 'lucide-react'

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname?.endsWith('/login')

  if (isLoginPage) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>
  }

  const handleSignOut = () => {
    document.cookie = "mock_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;"
    window.location.href = '/superadmin/login'
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 border-r border-border bg-card flex-col shrink-0">
        <div className="p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">God Mode</h2>
            <p className="text-sm text-muted-foreground">Super Admin Portal</p>
          </div>
          <ThemeToggle />
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <Link href="/superadmin" className={`block px-4 py-2 rounded-md font-bold transition-all ${pathname === '/superadmin' ? 'bg-secondary text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}>
            Dashboard
          </Link>
          <Link href="/superadmin/agents" className={`block px-4 py-2 rounded-md font-medium transition-all ${pathname === '/superadmin/agents' ? 'bg-secondary text-primary font-bold' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}>
            Agents
          </Link>
        </nav>
        <div className="p-4 border-t border-border">
          <button onClick={handleSignOut} className="w-full px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 rounded-md transition-colors font-semibold cursor-pointer text-left">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Mobile Header Bar */}
        <header className="flex md:hidden items-center justify-between h-14 px-4 bg-card border-b border-border z-20 shrink-0">
          <div>
            <h2 className="text-base font-extrabold tracking-tight">God Mode</h2>
            <p className="text-[10px] text-muted-foreground">Super Admin</p>
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
        <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-background pb-20 md:pb-8">
          {children}
        </main>

        {/* Mobile Bottom Navigation Bar */}
        <nav className="flex md:hidden fixed bottom-0 left-0 right-0 h-16 bg-card border-t border-border z-20 items-center justify-around">
          <Link 
            href="/superadmin" 
            className={`flex flex-col items-center justify-center flex-1 h-full font-bold transition-all ${pathname === '/superadmin' ? 'text-primary' : 'text-muted-foreground'}`}
          >
            <LayoutDashboard className="h-5 w-5" />
            <span className="text-[10px] mt-1 tracking-wider uppercase">Overview</span>
          </Link>
          <Link 
            href="/superadmin/agents" 
            className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${pathname === '/superadmin/agents' ? 'text-primary font-bold' : 'text-muted-foreground'}`}
          >
            <Users className="h-5 w-5" />
            <span className="text-[10px] mt-1 tracking-wider uppercase">Agents</span>
          </Link>
        </nav>
      </div>
    </div>
  )
}
