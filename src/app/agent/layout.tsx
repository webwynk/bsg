"use client"

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { Wallet, Users, History, LogOut, ShieldCheck, TrendingUp } from 'lucide-react'

export default function AgentLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname?.endsWith('/login')

  if (isLoginPage) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>
  }

  const isCashierActive = pathname === '/agent' || pathname === '/agent/'
  const isPlayersActive = !!pathname?.startsWith('/agent/players')
  const isProfitActive = !!pathname?.startsWith('/agent/profit')
  const isHistoryActive = !!pathname?.startsWith('/agent/history')

  const handleSignOut = async () => {
    const { signOutAction } = await import('@/app/actions/auth')
    await signOutAction('/agent/login')
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
            href="/agent/profit" 
            className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl transition-all text-xs font-bold ${
              isProfitActive 
                ? 'bg-primary text-primary-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            <TrendingUp className="h-4 w-4 shrink-0" />
            <span>P&L Report</span>
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

        {/* Mobile Bottom Navigation Bar (Modern Floating Glassmorphic Design) */}
        <nav className="flex md:hidden fixed bottom-2.5 left-3 right-3 h-14 bg-card/90 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl z-30 items-center justify-around px-1.5">
          <Link 
            href="/agent" 
            className={`relative flex flex-col items-center justify-center flex-1 h-11 mx-0.5 rounded-xl transition-all duration-300 cursor-pointer ${
              isCashierActive 
                ? 'bg-primary/15 text-primary border border-primary/25 shadow-xs font-black' 
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 font-semibold'
            }`}
          >
            {isCashierActive && (
              <span className="absolute -top-1 w-3 h-1 rounded-full bg-primary animate-pulse shadow-xs" />
            )}
            <Wallet className={`h-4 w-4 transition-transform duration-300 ${isCashierActive ? 'scale-110 stroke-[2.5]' : 'stroke-[1.8]'}`} />
            <span className={`text-[9px] mt-0.5 tracking-wider uppercase ${isCashierActive ? 'font-black text-primary' : 'font-bold'}`}>
              Cashier
            </span>
          </Link>

          <Link 
            href="/agent/players" 
            className={`relative flex flex-col items-center justify-center flex-1 h-11 mx-0.5 rounded-xl transition-all duration-300 cursor-pointer ${
              isPlayersActive 
                ? 'bg-primary/15 text-primary border border-primary/25 shadow-xs font-black' 
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 font-semibold'
            }`}
          >
            {isPlayersActive && (
              <span className="absolute -top-1 w-3 h-1 rounded-full bg-primary animate-pulse shadow-xs" />
            )}
            <Users className={`h-4 w-4 transition-transform duration-300 ${isPlayersActive ? 'scale-110 stroke-[2.5]' : 'stroke-[1.8]'}`} />
            <span className={`text-[9px] mt-0.5 tracking-wider uppercase ${isPlayersActive ? 'font-black text-primary' : 'font-bold'}`}>
              Players
            </span>
          </Link>

          <Link 
            href="/agent/profit" 
            className={`relative flex flex-col items-center justify-center flex-1 h-11 mx-0.5 rounded-xl transition-all duration-300 cursor-pointer ${
              isProfitActive 
                ? 'bg-primary/15 text-primary border border-primary/25 shadow-xs font-black' 
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 font-semibold'
            }`}
          >
            {isProfitActive && (
              <span className="absolute -top-1 w-3 h-1 rounded-full bg-primary animate-pulse shadow-xs" />
            )}
            <TrendingUp className={`h-4 w-4 transition-transform duration-300 ${isProfitActive ? 'scale-110 stroke-[2.5]' : 'stroke-[1.8]'}`} />
            <span className={`text-[9px] mt-0.5 tracking-wider uppercase ${isProfitActive ? 'font-black text-primary' : 'font-bold'}`}>
              P&L
            </span>
          </Link>

          <Link 
            href="/agent/history" 
            className={`relative flex flex-col items-center justify-center flex-1 h-11 mx-0.5 rounded-xl transition-all duration-300 cursor-pointer ${
              isHistoryActive 
                ? 'bg-primary/15 text-primary border border-primary/25 shadow-xs font-black' 
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 font-semibold'
            }`}
          >
            {isHistoryActive && (
              <span className="absolute -top-1 w-3 h-1 rounded-full bg-primary animate-pulse shadow-xs" />
            )}
            <History className={`h-4 w-4 transition-transform duration-300 ${isHistoryActive ? 'scale-110 stroke-[2.5]' : 'stroke-[1.8]'}`} />
            <span className={`text-[9px] mt-0.5 tracking-wider uppercase ${isHistoryActive ? 'font-black text-primary' : 'font-bold'}`}>
              History
            </span>
          </Link>
        </nav>
      </div>
    </div>
  )
}
