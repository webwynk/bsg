import * as React from 'react'
import { agentLogin } from './actions'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { KeyRound, Lock, User } from 'lucide-react'

interface Props {
  searchParams: Promise<{ error?: string }>
}

export default async function AgentLogin({ searchParams }: Props) {
  const { error } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background p-4 sm:p-6">
      <div className="w-full max-w-md space-y-4">
        {/* Visual Brand Accent */}
        <div className="flex flex-col items-center text-center space-y-2 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-lg shadow-primary/5">
            <KeyRound className="h-6 w-6 animate-pulse" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground">
            Best Smart Game
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
            Agent Operations
          </p>
        </div>

        <Card className="border-border/60 bg-card/85 backdrop-blur-md text-foreground shadow-2xl rounded-2xl overflow-hidden relative">
          {/* Top glowing strip */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/30 via-primary to-primary/30" />

          <CardHeader className="space-y-1.5 pt-8">
            <CardTitle className="text-2xl font-black tracking-tight text-center">
              Agent Back Office
            </CardTitle>
            <CardDescription className="text-muted-foreground text-center text-xs">
              Enter your credentials to manage your players and cashier
            </CardDescription>
          </CardHeader>

          <form action={agentLogin}>
            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/10 flex items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-2 shrink-0 animate-ping" />
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Email Address
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/70" />
                  <Input
                    id="username"
                    name="username"
                    type="email"
                    placeholder="agent@example.com"
                    className="pl-9 bg-background/50 border-border/80 focus:border-primary/50 text-sm h-10 rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/70" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="••••••••"
                    className="pl-9 bg-background/50 border-border/80 focus:border-primary/50 text-sm h-10 rounded-lg"
                    required
                  />
                </div>
              </div>
            </CardContent>

            <div className="flex flex-col space-y-4 px-6 pt-4 pb-8">
              <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/95 h-11 rounded-lg font-bold text-sm tracking-wide shadow-lg shadow-primary/10 cursor-pointer select-none">
                Sign In to Back Office
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Forgot your credentials? Please contact your platform Super Admin.
              </p>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
