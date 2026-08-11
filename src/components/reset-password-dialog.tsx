"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Eye, EyeOff } from "lucide-react"
import { resetPlayerPasswordAction } from "@/app/agent/players/actions"

/**
 * Self-contained reset-password popup -- identity card (name + username),
 * two password fields, submit, short success message. Extracted from the
 * Players page so the Alerts page (Issue #52) can offer the exact same
 * "Reset Password" action directly from a security notification, without a
 * second copy of this form drifting out of sync with the original.
 *
 * `action` (Issue #67) makes this generic across account types -- defaults
 * to resetPlayerPasswordAction so every existing call site is unaffected;
 * the superadmin alerts page passes updateAgentPasswordAction instead, to
 * reset a locked agent/superadmin's password through this same dialog
 * rather than a second near-duplicate form.
 */
export function ResetPasswordDialog({
  playerId,
  playerName,
  playerUsername,
  trigger,
  onSuccess,
  action = resetPlayerPasswordAction,
}: {
  playerId: string
  playerName: string
  playerUsername: string
  /** Base UI's DialogTrigger takes `render`, not Radix's `asChild` -- must
   * be a single ReactElement (e.g. a <button>), not arbitrary ReactNode. */
  trigger: React.ReactElement
  onSuccess?: () => void
  action?: (identifier: string, newPassword: string) => Promise<{ success?: boolean; error?: string }>
}) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [isResetting, setIsResetting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const [showNewPassword, setShowNewPassword] = React.useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false)

  function reset() {
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setSuccess(null)
    setShowNewPassword(false)
    setShowConfirmPassword(false)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsResetting(true)
    setError(null)

    const res = await action(playerId, newPassword)

    setIsResetting(false)
    if (res.error) {
      setError(res.error)
    } else {
      setSuccess('Password updated successfully!')
      onSuccess?.()
      setTimeout(() => {
        setIsOpen(false)
        reset()
      }, 1200)
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        reset()
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[380px] bg-card border-border text-foreground rounded-2xl p-5">
        <DialogHeader>
          <DialogTitle className="font-black text-lg">Reset Password</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Set a new password for this account.
          </DialogDescription>
        </DialogHeader>

        {/* Identity confirmation -- name AND username both visible before the
            agent commits to a reset, so there's no ambiguity about which
            account this affects. */}
        <div className="flex items-center space-x-2.5 p-2.5 rounded-xl bg-secondary/40 border border-border/60">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-xs shrink-0">
            {playerName[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-foreground truncate">{playerName}</p>
            <p className="text-[10px] text-muted-foreground font-mono truncate">@{playerUsername}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 py-2">
          {error && (
            <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">
              {error}
            </div>
          )}
          {success && (
            <div className="p-2.5 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20">
              {success}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="new-password">New Password</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNewPassword ? "text" : "password"}
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-10 w-full bg-background border-border text-foreground pr-10 text-xs rounded-lg"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
              >
                {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-10 w-full bg-background border-border text-foreground pr-10 text-xs rounded-lg"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground cursor-pointer focus:outline-none"
              >
                {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="submit"
              disabled={isResetting}
              className="w-full h-10 font-extrabold cursor-pointer text-xs rounded-lg"
            >
              {isResetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isResetting ? 'Updating Password...' : 'Save New Password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
