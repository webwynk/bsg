"use client"

import { TrendingUp } from 'lucide-react'
import { AgentCommissionReport } from '@/components/agent-commission-report'

/**
 * The agent's own Profit & Loss page (/agent/profit).
 *
 * Since 2026-11-08 (Hasan: the old tiles and per-player table are not needed
 * for agents; plan docs/AGENT_PROFIT_PAGE_PLAN.md) it shows only the read-only
 * "My P&L & Commission" block: its own filter (Pick dates / Today / 7 days /
 * 30 days / Lifetime, IST days), Bets − Wins = P&L, + commission (bets × the %
 * the superadmin set) = Final, by game, by day and a PDF. The block loads the
 * logged-in agent's own figures (agentIdentifier null; the server always uses
 * the caller's own id for an agent) and keeps itself fresh (useLiveSync).
 * An agent with no % set sees 0% and commission 0.
 */
export default function AgentProfitPage() {
  return (
    <div className="space-y-3 max-w-7xl mx-auto px-2 sm:px-4 md:px-0 pb-12">
      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-card border border-border/80 rounded-2xl shadow-xs">
        <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0">
          <TrendingUp className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-black tracking-tight text-foreground leading-tight">Profit &amp; Loss</h1>
          <p className="text-muted-foreground text-[11px] leading-tight">
            Your players&apos; bets, wins and your commission. The commission % is set by the admin.
          </p>
        </div>
      </div>

      <AgentCommissionReport agentIdentifier={null} title="My P&L & Commission" />
    </div>
  )
}
