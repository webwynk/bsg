'use client'

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ResponsivePagination } from '@/components/responsive-pagination'
import { ErrorBanner } from '@/components/error-banner'
import { RangeFilter, PillTab, type RangeChoice } from '@/components/range-filter'
import { useLiveSync } from '@/hooks/use-live-sync'
import { useRequestGeneration } from '@/hooks/use-request-generation'
import type { LiveTable } from '@/components/live-data-provider'
import { Download, Loader2, TrendingUp, Info, Minus, Equal } from 'lucide-react'
import { GAMES } from '@/lib/money-totals-logic'
import { presetRange, type DayRange, type GameplayPreset } from '@/lib/gameplay-range'
import {
  EMPTY_COMMISSION_REPORT, agentStatementFileName, buildStatementModel, coins, commissionLines, formatPct, fullDay,
  periodText, pnlOf, rateChanged, rateSummary, signedCoins, type CommissionReport,
} from '@/lib/agent-commission'
import { getAgentCommissionReportAction } from '@/app/superadmin/agents/agent-commission-actions'
import type { CommissionAgent } from '@/app/superadmin/agents/agent-commission-data'

/** Hasan's filter for this block: Pick dates | Today | 7 days | 30 days | Lifetime (IST days). */
const PRESETS: readonly GameplayPreset[] = ['today', '7d', '30d', 'lifetime']
const LIVE_TABLES: LiveTable[] = ['rounds', 'lucky_card_rounds', 'spin2win_rounds', 'lucky16_rounds', 'coin_ledger']
const DAYS_PER_PAGE = 10

type Loader = typeof getAgentCommissionReportAction

/**
 * Agent P&L & commission block (2026-11-08; plan docs/AGENT_COMMISSION_PLAN.md).
 * Used on the superadmin agent page (any agent) and on the agent's own P&L page
 * (agentIdentifier null = the logged-in agent; the server ignores anything
 * else for an agent). Read-only: the % is set in AgentCommissionEditDialog.
 *
 * For the chosen period (IST days): Bets (In) - Wins (Out) = P&L; Commission =
 * bets x the agent's % on each day; Final = P&L - Commission, always
 * (agent-commission.ts). Then the figures by game and by day, and
 * a PDF of exactly what is on screen. Kept fresh by useLiveSync ('normal').
 */
export function AgentCommissionReport({
  agentIdentifier,
  generatedBy,
  reloadSignal = 0,
  onCurrentRate,
  loadReport = getAgentCommissionReportAction,
  title = 'P&L & Commission',
}: {
  agentIdentifier: string | null
  /** Who downloads the PDF, printed on it (default: the agent themself, "agent @agent2"). */
  generatedBy?: string
  /** Bump to reload now (after the % was changed). */
  reloadSignal?: number
  /** Tells the parent the agent's % today (for the header chip). */
  onCurrentRate?: (pct: number) => void
  /** Only so the block can be rendered with sample data; pages always use the server action. */
  loadReport?: Loader
  title?: string
}) {
  const [choice, setChoice] = React.useState<RangeChoice>({ preset: 'today', custom: null })
  const [view, setView] = React.useState<'game' | 'day'>('game')
  const [page, setPage] = React.useState(1)
  const [loaded, setLoaded] = React.useState<{ key: string; report: CommissionReport; agent: CommissionAgent | null } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = React.useState(false)
  const request = useRequestGeneration()

  const key = `${agentIdentifier}|${choice.preset}|${choice.custom?.from}|${choice.custom?.to}`
  const current = React.useRef({ agentIdentifier, choice, key })
  React.useEffect(() => { current.current = { agentIdentifier, choice, key } })
  const rateCb = React.useRef(onCurrentRate)
  React.useEffect(() => { rateCb.current = onCurrentRate })

  const load = React.useCallback(() => {
    const f = current.current
    const range: DayRange | null = f.choice.preset ? presetRange(f.choice.preset, new Date()) : f.choice.custom
    const token = request.nextGeneration()
    return loadReport(f.agentIdentifier, range).then((res) => {
      if (!request.isCurrent(token)) return
      setError(res.error)
      if (!res.error) {
        setLoaded({ key: f.key, report: res.report, agent: res.agent })
        rateCb.current?.(res.report.currentRatePct)
      }
    }).catch((e) => {
      if (!request.isCurrent(token)) return
      setError(e instanceof Error ? e.message : 'Could not load the commission report.')
    })
  }, [loadReport, request])

  const { refresh } = useLiveSync(LIVE_TABLES, load, 'normal')
  const lastKey = React.useRef(`${key}#${reloadSignal}`)
  React.useEffect(() => {
    const k = `${key}#${reloadSignal}`
    if (lastKey.current === k) return
    lastKey.current = k
    refresh()
  }, [key, reloadSignal, refresh])

  const ready = loaded !== null && loaded.key === key
  const report = ready ? loaded.report : EMPTY_COMMISSION_REPORT
  const range = choice.preset ? presetRange(choice.preset, new Date()) : choice.custom
  const period = periodText(range, choice.preset)
  const lines = commissionLines(report.totals)
  const rates = rateSummary(report.rates, report.currentRatePct)
  const totalPages = Math.max(1, Math.ceil(report.days.length / DAYS_PER_PAGE))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageDays = report.days.slice((safePage - 1) * DAYS_PER_PAGE, safePage * DAYS_PER_PAGE)

  const downloadPdf = async () => {
    if (!ready || !loaded.agent) return
    setPdfBusy(true)
    try {
      const [{ default: jsPDF }, { buildAgentStatementPdf }] = await Promise.all([import('jspdf'), import('@/lib/agent-statement-pdf')])
      const generatedAt = `${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} IST`
      buildAgentStatementPdf(jsPDF, {
        agent: { fullName: loaded.agent.fullName, username: loaded.agent.username, accountCode: loaded.agent.accountCode },
        period, generatedAt, generatedBy: generatedBy ?? `agent @${loaded.agent.username}`, model: buildStatementModel(report, GAMES),
      }).save(agentStatementFileName(loaded.agent.username, range))
    } catch (e) {
      setError(`Could not make the PDF: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setPdfBusy(false)
    }
  }

  const toneText = (n: number) => (n < 0 ? 'text-red-400' : 'text-emerald-400')

  // One PDF button, placed next to the title on phone/tablet and next to the filter on desktop.
  const pdfButton = (where: string) => (
    <Button
      type="button"
      onClick={downloadPdf}
      disabled={!ready || !loaded?.agent || pdfBusy}
      className={`h-8 shrink-0 rounded-xl px-3 text-[11px] font-extrabold gap-1.5 bg-violet-600 hover:bg-violet-500 text-white cursor-pointer ${where}`}
    >
      {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      PDF
    </Button>
  )

  return (
    <Card className="border-border/80 bg-card rounded-2xl overflow-hidden shadow-xs">
      {/* Header: title + period (+ PDF below lg), filter (+ PDF from lg) */}
      <div className="px-3 py-2.5 border-b border-border/60 bg-gradient-to-r from-violet-500/[0.07] via-transparent to-emerald-500/[0.05]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/25 shrink-0">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-black tracking-tight text-foreground truncate leading-tight">{title}</h3>
              <p className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground leading-snug sm:truncate">
                {ready && loaded.agent ? `${loaded.agent.fullName} · @${loaded.agent.username} · ` : ''}{period} (IST)
              </p>
            </div>
            {pdfButton('lg:hidden')}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
            <RangeFilter value={choice} onChange={(next) => { setChoice(next); setPage(1) }} presets={PRESETS} calendarFirst />
            {pdfButton('hidden lg:inline-flex')}
          </div>
        </div>
      </div>

      <div className="p-2.5 sm:p-3 space-y-2.5">
        <ErrorBanner error={error} />

        {/* The statement: Bets - Wins = P&L, - Commission = Final */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Figure label="Bets (In)" hint={`${report.totals.plays.toLocaleString('en-IN')} plays`} value={coins(lines.stake)} loading={!ready} />
          <Figure label="Wins (Out)" hint="Paid to players" value={coins(lines.payout)} valueClass="text-amber-400" loading={!ready} op={<Minus className="h-2.5 w-2.5" />} />
          <Figure label="P&L" hint="Bets − Wins" value={signedCoins(lines.pnl)} valueClass={toneText(lines.pnl)} loading={!ready} op={<Equal className="h-2.5 w-2.5" />} />
          <Figure
            label="Commission"
            hint={`${rates} of bets`}
            value={coins(lines.commission)}
            valueClass="text-violet-300"
            loading={!ready}
            op={<Minus className="h-2.5 w-2.5" />}
            badge={<span className="inline-flex items-center gap-0.5 rounded-md bg-violet-500/15 border border-violet-500/25 px-1.5 py-0.5 text-[9px] font-black text-violet-300">now {formatPct(report.currentRatePct)}</span>}
          />
          <div className={`col-span-2 lg:col-span-1 relative rounded-xl border px-2.5 lg:pl-4 py-2 min-w-0 ${!ready ? 'border-border/50 bg-secondary/20' : lines.final < 0 ? 'border-red-500/30 bg-gradient-to-br from-red-500/15 to-red-500/[0.03]' : 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 to-emerald-500/[0.03]'}`}>
            <span className="hidden lg:flex absolute -left-[11px] top-1/2 -translate-y-1/2 h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground"><Equal className="h-2.5 w-2.5" /></span>
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground block">Final</span>
            {!ready ? <div className="h-6 w-24 mt-0.5 bg-secondary/80 animate-pulse rounded" /> : (
              <div className={`text-base sm:text-lg font-black font-mono truncate leading-tight ${toneText(lines.final)}`}>{signedCoins(lines.final)}</div>
            )}
            <p className="text-[9px] text-muted-foreground/80 truncate">P&amp;L minus commission</p>
          </div>
        </div>

        {ready && rateChanged(report.rates) && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-[10px] sm:text-[11px] text-amber-200">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>The % changed in this period ({rates}). Each day uses the % that was valid that day.</span>
          </div>
        )}

        {/* Details: by game / by day */}
        <div className="flex items-center justify-between gap-2">
          <div role="tablist" aria-label="Details" className="flex items-center gap-1.5">
            <PillTab active={view === 'game'} onClick={() => setView('game')}>By game</PillTab>
            <PillTab active={view === 'day'} onClick={() => setView('day')}>By day{ready ? ` (${report.days.length})` : ''}</PillTab>
          </div>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">Report figure only — no coins move</span>
        </div>

        {!ready ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-xl bg-secondary/20 animate-pulse border border-border/40" />)}</div>
        ) : view === 'game' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-1.5 sm:gap-2">
            {GAMES.map((g) => {
              const f = report.games[g.key]; const p = pnlOf(f)
              return (
                <div key={g.key} className="rounded-lg border border-border/60 bg-secondary/15 px-2.5 py-2 space-y-1.5 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-black text-foreground truncate"><span className={`h-2 w-2 rounded-full ${g.dot}`} />{g.label}</span>
                    <span className="text-[10px] font-semibold text-muted-foreground">{f.plays.toLocaleString('en-IN')} plays</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px]">
                    <Row label="Bets" value={coins(f.stake)} />
                    <Row label="Wins" value={coins(f.payout)} cls="text-amber-400" />
                    <Row label="P&L" value={signedCoins(p)} cls={toneText(p)} />
                    <Row label="Commission" value={coins(f.commission)} cls="text-violet-300" />
                  </div>
                </div>
              )
            })}
          </div>
        ) : report.days.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground font-medium rounded-xl border border-border/50">No plays by this agent&apos;s players in this period.</div>
        ) : (
          <>
            {/* Phone/tablet: cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 lg:hidden">
              {pageDays.map((d) => {
                const p = pnlOf(d)
                return (
                  <div key={d.day} className="rounded-lg border border-border/60 bg-secondary/15 px-2.5 py-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-black text-foreground">{fullDay(d.day)}</span>
                      <span className={`font-mono text-xs font-black ${toneText(p)}`}>{signedCoins(p)}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1 rounded-md bg-secondary/30 px-1.5 py-1 text-center text-[10px]">
                      {([['Bets', coins(d.stake), 'text-foreground'], ['Wins', coins(d.payout), 'text-amber-400'], ['%', formatPct(d.ratePct), 'text-muted-foreground'], ['Comm.', coins(d.commission), 'text-violet-300']] as const).map(([l, v, c]) => (
                        <div key={l} className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{l}</span><span className={`block font-mono font-black truncate ${c}`}>{v}</span></div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Desktop: table */}
            <div className="hidden lg:block overflow-x-auto table-scroll rounded-xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                    {['Date (IST)', 'Plays', 'Bets (In)', 'Wins (Out)', 'P&L', '%', 'Commission'].map((h, i) => (
                      <TableHead key={h} className={`text-muted-foreground text-[10px] uppercase tracking-wider ${i ? 'text-right' : ''}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageDays.map((d) => {
                    const p = pnlOf(d)
                    return (
                      <TableRow key={d.day} className="border-border hover:bg-secondary/30">
                        <TableCell className="font-mono text-[11px] font-bold text-foreground px-2.5 py-1.5">{fullDay(d.day)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] text-muted-foreground px-2.5 py-1.5">{d.plays.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] font-bold text-foreground px-2.5 py-1.5">{coins(d.stake)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] font-bold text-amber-400 px-2.5 py-1.5">{coins(d.payout)}</TableCell>
                        <TableCell className={`text-right font-mono text-[11px] font-black px-2.5 py-1.5 ${toneText(p)}`}>{signedCoins(p)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] text-muted-foreground px-2.5 py-1.5">{formatPct(d.ratePct)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] font-bold text-violet-300 px-2.5 py-1.5">{coins(d.commission)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {report.days.length > DAYS_PER_PAGE && (
              <ResponsivePagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} totalItems={report.days.length} itemsPerPage={DAYS_PER_PAGE} />
            )}
          </>
        )}
      </div>
    </Card>
  )
}

function Figure({ label, hint, value, valueClass = 'text-foreground', loading, op, badge }: {
  label: string; hint: string; value: string; valueClass?: string; loading: boolean; op?: React.ReactNode; badge?: React.ReactNode
}) {
  return (
    <div className="relative rounded-xl border border-border/50 bg-secondary/20 px-2.5 lg:pl-4 py-2 min-w-0">
      {op && <span className="hidden lg:flex absolute -left-[11px] top-1/2 -translate-y-1/2 h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground z-10">{op}</span>}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground truncate">{label}</span>
        {badge}
      </div>
      {loading ? <div className="h-5 w-20 mt-0.5 bg-secondary/80 animate-pulse rounded" /> : (
        <div className={`text-sm sm:text-base font-black font-mono truncate leading-tight ${valueClass}`}>{value}</div>
      )}
      <p className="text-[9px] text-muted-foreground/80 truncate">{hint}</p>
    </div>
  )
}

function Row({ label, value, cls = 'text-foreground' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-bold truncate ${cls}`}>{value}</span>
    </div>
  )
}
