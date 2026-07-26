"use client"

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { Wallet, Users, History, LogOut, ShieldCheck } from 'lucide-react'

export default function AgentLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname?.endsWith('/login')

  if (isLoginPage) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>
  }

  const isCashierActive = pathname === '/agent' || pathname === '/agent/'
  const isPlayersActive = !!pathname?.startsWith('/agent/players')
  const isHistoryActive = !!pathname?.startsWith('/agent/history')

  const handleSignOut = () => {
    document.cookie = "mock_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;"
    window.location.href = '/agent/login'
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Desktop Sidebar (Compact w-52) */}
      <aside className="hidden md:flex w-52 border-r border-border bg-card flex-col shrink-0">
        <div className="p-4 flex items-center justify-between border-b border-border/50">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-foreground leading-tight">Back Office</h2>
              <p className="text-[10px] text-muted-foreground font-semibold">Agent Portal</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
        <nav className="flex-1 p-2 space-y-1">
          <Link 
            href="/agent" 
            className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl transition-all text-xs font-bold ${
              isCashierActive 
                ? 'bg-primary text-primary-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            <Wallet className="h-4 w-4 shrink-0" />
            <span>Cashier</span>
          </Link>
          <Link 
            href="/agent/players" 
            className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl transition-all text-xs font-bold ${
              isPlayersActive 
                ? 'bg-primary text-primary-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            <Users className="h-4 w-4 shrink-0" />
            <span>Players</span>
          </Link>
          <Link 
            href="/agent/history" 
            className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl transition-all text-xs font-bold ${
              isHistoryActive 
                ? 'bg-primary text-primary-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            <History className="h-4 w-4 shrink-0" />
            <span>History</span>
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
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold tracking-tight">Back Office</h2>
              <p className="text-[10px] text-muted-foreground">Agent Portal</p>
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
            href="/agent" 
            className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
              isCashierActive ? 'text-primary font-extrabold' : 'text-muted-foreground'
            }`}
          >
            <Wallet className="h-5 w-5" />
            <span className="text-[10px] mt-1 tracking-wider uppercase font-bold">Cashier</span>
          </Link>
          <Link 
            href="/agent/players" 
            className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
              isPlayersActive ? 'text-primary font-extrabold' : 'text-muted-foreground'
            }`}
          >
            <Users className="h-5 w-5" />
            <span className="text-[10px] mt-1 tracking-wider uppercase font-bold">Players</span>
          </Link>
          <Link 
            href="/agent/history" 
            className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
              isHistoryActive ? 'text-primary font-extrabold' : 'text-muted-foreground'
            }`}
          >
            <History className="h-5 w-5" />
            <span className="text-[10px] mt-1 tracking-wider uppercase font-bold">History</span>
          </Link>
        </nav>
      </div>
    </div>
  )
}
