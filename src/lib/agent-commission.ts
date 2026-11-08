/**
 * Agent commission -- pure rules, no imports beyond types, tested on their own
 * (agent-commission.test.ts, `node --test`). Plan: docs/AGENT_COMMISSION_PLAN.md.
 *
 * Hasan's rule (2026-11-08), for one agent and one period:
 *   Bets       = coins that agent's players bet (all 4 games, phone + Print)
 *   Wins       = coins those players won
 *   P&L        = Bets - Wins
 *   Commission = Bets x the agent's % (each IST day at the % valid that day)
 *   Final      = P&L - Commission, always (Hasan, 2026-11-08 13:19 UTC; it
 *                replaced the earlier "away from zero" rule). The commission
 *                is always taken off, whether the players won or lost:
 *                Bets 6,000 / won 5,000 -> P&L +1,000, 5% (300) -> Final +700
 *                Bets 6,000 / won 7,000 -> P&L -1,000, 5% (300) -> Final -1,300
 *                Bets 6,000 / won 6,000 -> P&L 0,      5% (300) -> Final -300
 * The commission is a report figure only: no coins move.
 *
 * The database (staff_agent_commission_report) returns the commission EXACT;
 * figures are rounded to 2 decimals only when shown (roundCoins).
 */

import type { GameKey } from './money-totals-logic'
import type { DayRange, GameplayPreset } from './gameplay-range'

export interface CommissionFigures { plays: number; stake: number; payout: number; commission: number }
export interface CommissionDay extends CommissionFigures { day: string; ratePct: number }
export interface CommissionRate { effectiveFrom: string; ratePct: number }
export interface CommissionReport {
  totals: CommissionFigures
  days: CommissionDay[]
  games: Record<GameKey, CommissionFigures>
  /** The % in force at the start of the period plus every change inside it (oldest first). */
  rates: CommissionRate[]
  /** The agent's % today (IST). */
  currentRatePct: number
}

const GAME_KEYS: readonly GameKey[] = ['triple_chance', 'lucky_card', 'spin2win', 'lucky16']
const ZERO: CommissionFigures = { plays: 0, stake: 0, payout: 0, commission: 0 }

export const EMPTY_COMMISSION_REPORT: CommissionReport = {
  totals: ZERO,
  days: [],
  games: { triple_chance: ZERO, lucky_card: ZERO, spin2win: ZERO, lucky16: ZERO },
  rates: [],
  currentRatePct: 0,
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
const figures = (v: unknown): CommissionFigures => {
  const o = (v ?? {}) as Record<string, unknown>
  return { plays: num(o.plays), stake: num(o.stake), payout: num(o.payout), commission: num(o.commission) }
}

/** Turns the database's jsonb answer into numbers (missing parts = 0 / empty). */
export function readCommissionReport(raw: unknown): CommissionReport {
  const o = (raw ?? {}) as Record<string, unknown>
  const games = (o.games ?? {}) as Record<string, unknown>
  return {
    totals: figures(o.totals),
    days: (Array.isArray(o.days) ? o.days : []).map((d) => {
      const r = d as Record<string, unknown>
      return { day: String(r.day ?? '').slice(0, 10), ratePct: num(r.rate_pct), ...figures(r) }
    }),
    games: Object.fromEntries(GAME_KEYS.map((k) => [k, figures(games[k])])) as Record<GameKey, CommissionFigures>,
    rates: (Array.isArray(o.rates) ? o.rates : []).map((x) => {
      const r = x as Record<string, unknown>
      return { effectiveFrom: String(r.effective_from ?? '').slice(0, 10), ratePct: num(r.rate_pct) }
    }),
    currentRatePct: num(o.current_rate_pct),
  }
}

/** Rounds to 2 decimals for display (half away from zero, no float drift like 0.1 + 0.2). */
export function roundCoins(n: number): number {
  const r = Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
  return n < 0 ? -r : r
}

/** P&L = Bets - Wins. */
export function pnlOf(f: Pick<CommissionFigures, 'stake' | 'payout'>): number {
  return f.stake - f.payout
}

/** Final = P&L - Commission, for a profit, a loss and a zero P&L alike (see the header). */
export function finalFigure(pnl: number, commission: number): number {
  return pnl - commission
}

/** All four figures of a block, rounded for display. */
export function commissionLines(f: CommissionFigures): { stake: number; payout: number; pnl: number; commission: number; final: number } {
  const pnl = pnlOf(f)
  return { stake: f.stake, payout: f.payout, pnl, commission: roundCoins(f.commission), final: roundCoins(finalFigure(pnl, f.commission)) }
}

/**
 * Checks a % typed in the Edit dialog: a number from 0 to 100 with at most 2
 * decimals. Returns the number, or an error message to show.
 */
export function parseRatePct(input: string | number): { pct: number } | { error: string } {
  const s = String(input).trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { error: 'Enter a number from 0 to 100 with at most 2 decimals (e.g. 5 or 7.25).' }
  const pct = Number(s)
  if (pct < 0 || pct > 100) return { error: 'The commission must be between 0 and 100%.' }
  return { pct }
}

/** "5%", "7.25%", "7.5%". */
export function formatPct(pct: number): string {
  return `${Number(pct.toFixed(2))}%`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-11-08' -> '8 Nov 2026'. */
export function fullDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/**
 * The period as shown on the screen and the PDF, always with full dates:
 * "Today: 8 Nov 2026", "Yesterday: 7 Nov 2026", "Last 7 days: 2 Nov 2026 – 8 Nov 2026",
 * "1 Nov 2026 – 5 Nov 2026" (picked), "Lifetime (all time)".
 */
export function periodText(range: DayRange | null, preset: GameplayPreset | null): string {
  if (!range) return 'Lifetime (all time)'
  const span = range.from === range.to ? fullDay(range.from) : `${fullDay(range.from)} – ${fullDay(range.to)}`
  switch (preset) {
    case 'today': return `Today: ${span}`
    case 'yesterday': return `Yesterday: ${span}`
    case '7d': return `Last 7 days: ${span}`
    case '30d': return `Last 30 days: ${span}`
    default: return span
  }
}

/**
 * The % used over the period, for the screen and the PDF: "5%" when one % applied,
 * "5% → 7.25% from 6 Nov 2026" when it changed inside the period, "0%" when none was set.
 * `fallback` (the current %) is used when the period has no rate rows at all.
 */
export function rateSummary(rates: readonly CommissionRate[], fallback = 0): string {
  if (rates.length === 0) return formatPct(fallback)
  if (rates.length === 1) return formatPct(rates[0].ratePct)
  return [formatPct(rates[0].ratePct), ...rates.slice(1).map((r) => `${formatPct(r.ratePct)} from ${fullDay(r.effectiveFrom)}`)].join(' → ')
}

/** True when more than one % applied inside the period (the screen and PDF then say so). */
export function rateChanged(rates: readonly CommissionRate[]): boolean {
  return new Set(rates.map((r) => r.ratePct)).size > 1
}

// ── Statement model (what the PDF prints; built here so it is tested with the rules) ──

export type Tone = 'ink' | 'muted' | 'amber' | 'pos' | 'neg'
export interface Cell { text: string; tone: Tone }
export interface StatementLine { label: string; hint: string; value: string; tone: Tone; strong: boolean }
export interface StatementModel {
  lines: StatementLine[]
  rateNote: string | null
  games: Cell[][]
  days: Cell[][]
}

/** 135748 -> "1,35,748"; 24.1425 -> "24.14"; 20686.3 -> "20,686.30"; -5500 -> "-5,500" (Indian grouping; whole numbers without decimals, others with exactly 2). */
export function coins(n: number): string {
  const r = roundCoins(n)
  const d = Number.isInteger(r) ? 0 : 2
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }).format(r)
}

/** "+2,500", "-5,500", "0". */
export function signedCoins(n: number): string {
  return `${n > 0 ? '+' : ''}${coins(n)}`
}

const toneOf = (n: number): Tone => (n < 0 ? 'neg' : 'pos')

/** Everything the statement shows, as text: summary lines, the rate note, game rows and day rows. */
export function buildStatementModel(r: CommissionReport, gameLabels: ReadonlyArray<{ key: GameKey; label: string }>): StatementModel {
  const l = commissionLines(r.totals)
  const rates = rateSummary(r.rates, r.currentRatePct)
  return {
    lines: [
      { label: 'Bets (In)', hint: `${r.totals.plays.toLocaleString('en-IN')} plays`, value: coins(l.stake), tone: 'ink', strong: false },
      { label: 'Wins (Out)', hint: 'paid to the players', value: coins(l.payout), tone: 'amber', strong: false },
      { label: 'P&L', hint: 'Bets - Wins', value: signedCoins(l.pnl), tone: toneOf(l.pnl), strong: false },
      { label: 'Agent commission', hint: `${rates} of bets`, value: coins(l.commission), tone: 'ink', strong: false },
      {
        label: 'Final',
        hint: 'P&L - commission',
        value: signedCoins(l.final), tone: toneOf(l.final), strong: true,
      },
    ],
    rateNote: rateChanged(r.rates) ? `The commission % changed in this period (${rates}); each day uses the % that was valid that day.` : null,
    games: gameLabels.map((g) => {
      const f = r.games[g.key]; const p = pnlOf(f)
      return [
        { text: g.label, tone: 'ink' }, { text: f.plays.toLocaleString('en-IN'), tone: 'muted' }, { text: coins(f.stake), tone: 'ink' },
        { text: coins(f.payout), tone: 'amber' }, { text: signedCoins(p), tone: toneOf(p) }, { text: coins(f.commission), tone: 'ink' },
      ]
    }),
    days: r.days.map((d) => {
      const p = pnlOf(d)
      return [
        { text: fullDay(d.day), tone: 'ink' }, { text: d.plays.toLocaleString('en-IN'), tone: 'muted' }, { text: coins(d.stake), tone: 'ink' },
        { text: coins(d.payout), tone: 'amber' }, { text: signedCoins(p), tone: toneOf(p) }, { text: formatPct(d.ratePct), tone: 'muted' },
        { text: coins(d.commission), tone: 'ink' },
      ]
    }),
  }
}

/** "agent2_PnL_2026-11-02_2026-11-08.pdf", "agent2_PnL_lifetime.pdf". */
export function agentStatementFileName(username: string, range: DayRange | null): string {
  const safe = username.replace(/[^A-Za-z0-9_-]/g, '_') || 'agent'
  if (!range) return `${safe}_PnL_lifetime.pdf`
  return range.from === range.to ? `${safe}_PnL_${range.from}.pdf` : `${safe}_PnL_${range.from}_${range.to}.pdf`
}
