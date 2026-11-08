'use client'

import * as React from 'react'
import { Coins, Users, Activity, Percent } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { formatPct } from '@/lib/agent-commission'
import { AgentCommissionReport } from '@/components/agent-commission-report'
import { AgentCommissionEditDialog } from '@/components/agent-commission-edit-dialog'

/**
 * Top of the superadmin agent page (2026-11-08 redesign; replaces the old
 * Coins / Players / Status cards). Four chips -- Coins (available to allocate),
 * Players (registered under this agent), Status, Commission % (with Edit) --
 * then the agent's P&L & Commission block with its own filter and PDF.
 */
export function AgentOverviewPanel({ agentIdentifier, agentUsername, coins, playersCount, status, loading, loadReport }: {
  agentIdentifier: string
  agentUsername: string
  coins: number
  playersCount: number
  status: { label: string; badgeClass: string } | null
  loading: boolean
  /** Only so the panel can be rendered with sample data; the page always uses the server action. */
  loadReport?: React.ComponentProps<typeof AgentCommissionReport>['loadReport']
}) {
  const [ratePct, setRatePct] = React.useState<number | null>(null)
  const [reloadSignal, setReloadSignal] = React.useState(0)

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Chip icon={<Coins className="h-3.5 w-3.5" />} tint="emerald" label="Coins" hint="Available to allocate">
          {loading ? <Skeleton /> : <span className="font-mono">{formatCurrency(coins)}</span>}
        </Chip>
        <Chip icon={<Users className="h-3.5 w-3.5" />} tint="sky" label="Players" hint="Registered under this agent">
          {loading ? <Skeleton /> : <span className="font-mono">{playersCount}</span>}
        </Chip>
        <Chip icon={<Activity className="h-3.5 w-3.5" />} tint="amber" label="Status" hint="Account status">
          {status ? <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${status.badgeClass}`}>{status.label}</span> : <Skeleton />}
        </Chip>
        <Chip
          icon={<Percent className="h-3.5 w-3.5" />}
          tint="violet"
          label="Commission"
          hint="Of players' total bets"
          action={ratePct !== null ? (
            <AgentCommissionEditDialog agentIdentifier={agentIdentifier} agentUsername={agentUsername} currentPct={ratePct} onSaved={() => setReloadSignal((n) => n + 1)} />
          ) : null}
        >
          {ratePct === null ? <Skeleton /> : <span className="font-mono text-violet-300">{formatPct(ratePct)}</span>}
        </Chip>
      </div>

      <AgentCommissionReport
        agentIdentifier={agentIdentifier}
        generatedBy="superadmin"
        reloadSignal={reloadSignal}
        onCurrentRate={setRatePct}
        loadReport={loadReport}
      />
    </div>
  )
}

const TINTS = {
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  sky: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/25',
} as const

function Chip({ icon, tint, label, hint, action = null, children }: {
  icon: React.ReactNode; tint: keyof typeof TINTS; label: string; hint: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card px-2.5 py-2 shadow-2xs flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`flex p-1 rounded-md border shrink-0 ${TINTS[tint]}`}>{icon}</span>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground truncate">{label}</span>
        </span>
        {action}
      </div>
      <div className="text-sm sm:text-base font-black text-foreground tracking-tight truncate leading-tight">{children}</div>
      <span className="text-[9px] text-muted-foreground/80 truncate">{hint}</span>
    </div>
  )
}

function Skeleton() {
  return <div className="h-5 w-14 bg-secondary/80 rounded animate-pulse" />
}
