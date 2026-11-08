'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Pencil, History } from 'lucide-react'
import { formatPct, fullDay, parseRatePct } from '@/lib/agent-commission'
import { istDayKey } from '@/lib/gameplay-range'
import { getAgentCommissionHistoryAction, setAgentCommissionAction } from '@/app/superadmin/agents/agent-commission-actions'
import type { CommissionHistoryRow } from '@/app/superadmin/agents/agent-commission-data'

/**
 * Superadmin: set an agent's commission % (2026-11-08). 0-100, up to 2
 * decimals. The new % counts from today (IST); earlier days keep the % they
 * had. The database checks the superadmin again and writes the audit log in
 * the same step. Shows the last 5 changes with who made them.
 */
export function AgentCommissionEditDialog({ agentIdentifier, agentUsername, currentPct, onSaved }: {
  agentIdentifier: string
  agentUsername: string
  currentPct: number
  onSaved: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState('')
  const [history, setHistory] = React.useState<CommissionHistoryRow[]>([])
  const [loadingHistory, setLoadingHistory] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setValue(String(currentPct))
    setError(null)
    setLoadingHistory(true)
    getAgentCommissionHistoryAction(agentIdentifier)
      .then((res) => { setHistory(res.history); if (res.error) setError(res.error) })
      .finally(() => setLoadingHistory(false))
  }

  const parsed = parseRatePct(value)
  const today = fullDay(istDayKey(new Date()))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if ('error' in parsed) { setError(parsed.error); return }
    setSaving(true)
    setError(null)
    const res = await setAgentCommissionAction(agentIdentifier, value)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setOpen(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger aria-label="Edit commission" className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-extrabold text-violet-300 hover:bg-violet-500/20 cursor-pointer transition-colors">
        <Pencil className="h-3 w-3" /><span className="hidden lg:inline">Edit</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px] bg-card border-border text-foreground rounded-2xl p-5">
        <DialogHeader>
          <DialogTitle className="font-black text-lg">Agent commission</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Commission = @{agentUsername}&apos;s players&apos; total bets × this %. A report figure only: no coins move.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3 py-1">
          {error && <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20">{error}</div>}
          <div className="space-y-1">
            <Label htmlFor="commission-pct" className="text-[11px]">Commission %</Label>
            <div className="relative">
              <Input
                id="commission-pct"
                inputMode="decimal"
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-11 w-full bg-background border-border text-foreground pr-9 text-base font-mono font-black rounded-lg"
                placeholder="e.g. 5 or 7.25"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-black text-muted-foreground">%</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Now: <span className="font-bold text-foreground">{formatPct(currentPct)}</span>. 0 to 100, up to 2 decimals.</p>
          </div>
          {'pct' in parsed && parsed.pct !== currentPct && (
            <div className="rounded-lg border border-violet-500/25 bg-violet-500/[0.08] p-2.5 text-[11px] text-violet-200">
              From today ({today}) @{agentUsername} gets <span className="font-black">{formatPct(parsed.pct)}</span> of bets. Earlier days keep the % they had.
            </div>
          )}
          <div className="rounded-lg border border-border/60 p-2.5 space-y-1.5">
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground"><History className="h-3 w-3" /> Last changes</span>
            {loadingHistory ? <div className="h-4 w-32 rounded bg-secondary/70 animate-pulse" /> : history.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Never set (0%).</p>
            ) : history.map((h) => (
              <div key={h.effectiveFrom} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">from {fullDay(h.effectiveFrom)}{h.setBy ? ` · @${h.setBy}` : ''}</span>
                <span className="font-mono font-black text-foreground">{formatPct(h.ratePct)}</span>
              </div>
            ))}
          </div>
          <DialogFooter className="pt-1">
            <Button type="submit" disabled={saving || !('pct' in parsed) || parsed.pct === currentPct} className="w-full h-10 font-extrabold cursor-pointer text-xs rounded-lg bg-violet-600 hover:bg-violet-500 text-white">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save commission'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
