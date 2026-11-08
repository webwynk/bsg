/**
 * P&L Audit tab (superadmin agent page, selected player) -- pure rules, no
 * imports, tested on their own (pnl-days.test.ts, `node --test`).
 *
 * The server returns one row per India (IST) day the player played, newest
 * first (staff_player_daily_money). These rules add the rows up for the four
 * cards, label the days and cut the list into pages.
 */

export interface PnlDay {
  /** IST day, 'YYYY-MM-DD'. */
  day: string
  plays: number
  stake: number
  payout: number
}

export interface PnlTotals {
  plays: number
  stake: number
  payout: number
  /** House profit = coins bet - coins won (negative when the player won more). */
  net: number
  /** net / stake x 100; 0 when nothing was bet. */
  marginPct: number
}

/** Rows per page in the P&L table. */
export const PNL_PAGE_SIZE = 10

/** House profit and margin of one day (or of totals). */
export function dayNet(d: { stake: number; payout: number }): { net: number; marginPct: number } {
  const net = d.stake - d.payout
  return { net, marginPct: d.stake > 0 ? (net / d.stake) * 100 : 0 }
}

/** All rows added together, for the four cards. */
export function pnlTotals(days: readonly PnlDay[]): PnlTotals {
  let plays = 0, stake = 0, payout = 0
  for (const d of days) { plays += d.plays; stake += d.stake; payout += d.payout }
  return { plays, stake, payout, ...dayNet({ stake, payout }) }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** '2026-11-08' -> '8 Nov 2026 · Sun' (the IST calendar day itself; no time-zone conversion). */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${d} ${MONTHS[m - 1]} ${y} · ${weekday}`
}

/** One page of rows (page from 1; past the end -> the last page). */
export function pnlPage<T>(rows: readonly T[], page: number): { items: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / PNL_PAGE_SIZE))
  const p = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  return { items: rows.slice((p - 1) * PNL_PAGE_SIZE, p * PNL_PAGE_SIZE), page: p, totalPages }
}
