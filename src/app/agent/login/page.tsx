"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { agentLogin } from './actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Lock, User, Eye, EyeOff, Loader2 } from 'lucide-react'

function LoginForm() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const [showPassword, setShowPassword] = React.useState(false)
  const [isPending, setIsPending] = React.useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    setIsPending(true)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-teal-950/40 via-slate-950 to-slate-950 p-4">
      <div className="w-full max-w-[340px]">
        {/* Ultra-Compact Glass Card */}
        <div className="w-full rounded-3xl bg-white/[0.06] backdrop-blur-2xl border border-white/15 shadow-2xl p-6 sm:p-7 space-y-6 text-white relative overflow-hidden">
          {/* Subtle Ambient Light Spot */}
          <div className="absolute -top-12 -left-12 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />

          {/* Top User SVG Silhouette Avatar */}
          <div className="flex flex-col items-center justify-center pt-1">
            <div className="w-20 h-20 rounded-full bg-white/[0.08] border border-white/20 flex items-center justify-center shadow-inner relative group">
              <svg className="w-10 h-10 text-white/80 drop-shadow-sm" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </div>
            <span className="mt-2 text-[10px] font-black tracking-widest text-emerald-400/90 uppercase">
              Agent Back Office
            </span>
          </div>

          <form action={agentLogin} onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-2.5 text-xs font-bold rounded-xl bg-red-500/20 text-red-200 border border-red-500/30 flex items-center shadow-sm">
                <span className="w-2 h-2 rounded-full bg-red-400 mr-2 shrink-0 animate-ping" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Username Field */}
              <div className="relative border-b border-white/25 focus-within:border-emerald-400 transition-colors py-1">
                <div className="flex items-center space-x-3">
                  <User className="h-4 w-4 text-white/70 shrink-0" />
                  <Input
                    id="username"
                    name="username"
                    placeholder="Username"
                    className="border-0 bg-transparent text-white placeholder:text-white/40 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-9 text-sm font-medium"
                    required
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="relative border-b border-white/25 focus-within:border-emerald-400 transition-colors py-1">
                <div className="flex items-center space-x-3">
                  <Lock className="h-4 w-4 text-white/70 shrink-0" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    className="border-0 bg-transparent text-white placeholder:text-white/40 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-9 text-sm font-medium pr-8"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-white/60 hover:text-white cursor-pointer focus:outline-none p-1 shrink-0"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Glowing Pill Action Button */}
            <div className="pt-2 space-y-3">
              <Button 
                type="submit" 
                disabled={isPending}
                className="w-full h-11 rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-black font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/25 cursor-pointer select-none transition-all active:scale-[0.98] border border-emerald-300/40"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-black" />
                    <span>SIGNING IN...</span>
                  </>
                ) : (
                  <span>LOGIN</span>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function AgentLogin() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-slate-950 flex items-center justify-center text-white/50 font-semibold text-sm">Loading...</div>}>
      <LoginForm />
    </React.Suspense>
  )
}
