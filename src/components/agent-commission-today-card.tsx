'use client'

import * as React from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Percent } from 'lucide-react'
import { useLiveSync } from '@/hooks/use-live-sync'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import type { LiveTable } from '@/components/live-data-provider'
import { presetRange } from '@/lib/gameplay-range'
import { coins, commissionLines, formatPct } from '@/lib/agent-commission'
import { getAgentCommissionReportAction } from '@/app/superadmin/agents/agent-commission-actions'

const LIVE_TABLES: LiveTable[] = ['rounds', 'lucky_card_rounds', 'spin2win_rounds', 'lucky16_rounds', 'coin_ledger']

/**
 * Agent dashboard: "Commission today" micro card (2026-11-08). The logged-in
 * agent's commission for today (IST) = today's bets by their players x their %.
 * Read-only; links to the full block on the agent's P&L page. Styled to match the
 * other three agent home cards (compact redesign 2026-11-08: icon left, title + figure right).
 */
export function AgentCommissionTodayCard() {
  const [data, setData] = React.useState<{ commission: number; pct: number } | null>(null)
  const [failed, setFailed] = React.useState(false)
  const request = useRequestGeneration()

  const load = React.useCallback(() => {
    const token = request.nextGeneration()
    return getAgentCommissionReportAction(null, presetRange('today', new Date())).then((res) => {
      if (!request.isCurrent(token)) return
      if (res.error) { setFailed(true); return }
      setFailed(false)
      setData({ commission: commissionLines(res.report.totals).commission, pct: res.report.currentRatePct })
    }).catch(() => { if (request.isCurrent(token)) setFailed(true) })
  }, [request])
  useLiveSync(LIVE_TABLES, load, 'normal')

  return (
    <Card size="sm" className="bg-card border-border/80 px-2.5 sm:px-3 rounded-xl shadow-2xs">
      <Link href="/agent/profit" className="flex items-start gap-2 sm:gap-2.5 min-w-0 cursor-pointer">
        <span className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0"><Percent className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-violet-400" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] sm:text-xs font-bold text-muted-foreground truncate">Commission Today</div>
          <div className={`text-sm sm:text-xl font-black font-mono leading-tight text-violet-300 truncate ${data || failed ? '' : 'opacity-50 animate-pulse'}`}>
            {data ? coins(data.commission) : failed ? '—' : '0'}
          </div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground/70 truncate hidden sm:block">{data ? `${formatPct(data.pct)} of today's bets` : failed ? 'Not available right now' : 'Loading…'}</p>
        </div>
      </Link>
    </Card>
  )
}
