"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { agentLogin } from './actions'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { KeyRound, Lock, User, Eye, EyeOff, Loader2, Sparkles } from 'lucide-react'

function LoginForm() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const [showPassword, setShowPassword] = React.useState(false)
  const [isPending, setIsPending] = React.useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    setIsPending(true)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-500/15 via-background to-background p-3.5 sm:p-6 py-6 sm:py-12">
      <div className="w-full max-w-md space-y-3.5">
        {/* Visual Brand Accent */}
        <div className="flex flex-col items-center text-center space-y-1.5 mb-1">
          <div className="w-13 h-13 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-500/10 relative group">
            <KeyRound className="h-6 w-6 animate-pulse" />
            <Sparkles className="h-3 w-3 absolute -top-1 -right-1 text-emerald-300" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
            Best Smart Game
          </h1>
          <p className="text-[11px] text-emerald-400/90 uppercase tracking-widest font-black">
            Agent Operations Portal
          </p>
        </div>

        <Card className="border-emerald-500/20 bg-card/90 backdrop-blur-xl text-foreground shadow-2xl rounded-2xl overflow-hidden relative">
          {/* Top glowing strip */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500/40 via-emerald-400 to-emerald-500/40" />

          <CardHeader className="space-y-1 pt-6 pb-2 sm:pt-7 sm:pb-3">
            <CardTitle className="text-xl sm:text-2xl font-black tracking-tight text-center">
              Agent Back Office
            </CardTitle>
            <CardDescription className="text-muted-foreground text-center text-xs">
              Enter credentials to manage players and cashier
            </CardDescription>
          </CardHeader>

          <form action={agentLogin} onSubmit={handleSubmit}>
            <CardContent className="space-y-3.5 pt-2">
              {error && (
                <div className="p-3 text-xs font-bold rounded-xl bg-danger-bg text-danger-text border border-red-500/20 flex items-center shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-red-500 mr-2.5 shrink-0 animate-ping" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="username" className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Username
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground/70" />
                  <Input
                    id="username"
                    name="username"
                    placeholder="agent"
                    className="pl-9 bg-background/60 border-border/80 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 text-sm h-10 rounded-xl transition-all"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="password" className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground/70" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className="pl-9 pr-10 bg-background/60 border-border/80 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 text-sm h-10 rounded-xl transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none p-1"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </CardContent>

            <div className="flex flex-col space-y-3 px-6 pt-2 pb-6 sm:pb-7">
              <Button 
                type="submit" 
                disabled={isPending}
                className="w-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500 hover:from-emerald-400 hover:to-emerald-500 text-black h-11 rounded-xl font-black text-sm tracking-wide shadow-lg shadow-emerald-500/20 cursor-pointer select-none border border-emerald-300/40 transition-all active:scale-[0.99]"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-black" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <span>Sign In to Back Office</span>
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center font-medium">
                Forgot your credentials? Contact platform SuperAdmin.
              </p>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}

export default function AgentLogin() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground font-semibold text-sm">Loading...</div>}>
      <LoginForm />
    </React.Suspense>
  )
}
