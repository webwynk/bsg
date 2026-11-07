/**
 * Date ranges for the superadmin "Gameplay & Bets Audit" card -- pure rules, no
 * imports, tested on their own (gameplay-range.test.ts, `node --test`).
 *
 * Every range is a set of whole India (IST, UTC+05:30, no daylight saving)
 * calendar days, written as 'YYYY-MM-DD' day keys. The server turns the keys
 * into the exact instants staff_money_summary needs: from = 00:00:00.000 IST of
 * the first day, to = 23:59:59.999 IST of the last day (the function's window
 * is inclusive at both ends). A bet counts on the IST day it was placed
 * (bets.created_at), the same as every other report on the dashboard.
 *
 * "Today" here is always a real instant converted to IST (istDayKey); a day
 * picked on the Calendar widget must instead be read with pickedDayKey()
 * (src/lib/date-range.ts), which keeps exactly the day that was clicked.
 */

export type GameplayPreset = 'today' | 'yesterday' | '7d' | '30d' | 'lifetime'

/** A chosen range: whole IST days, inclusive. null = lifetime (no limits). */
export interface DayRange {
  from: string
  to: string
}

export const GAMEPLAY_PRESETS: ReadonlyArray<{ value: GameplayPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'lifetime', label: 'Lifetime' },
]

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

/** The IST calendar day of a real instant, as 'YYYY-MM-DD'. */
export function istDayKey(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** The day key `days` days before (negative = after) `key`. */
export function shiftDayKey(key: string, days: number): string {
  const t = Date.parse(`${key}T00:00:00Z`) - days * DAY_MS
  return new Date(t).toISOString().slice(0, 10)
}

/** The days a preset covers, counted back from today in IST; null for lifetime. */
export function presetRange(preset: GameplayPreset, now: Date): DayRange | null {
  const today = istDayKey(now)
  switch (preset) {
    case 'today': return { from: today, to: today }
    case 'yesterday': { const y = shiftDayKey(today, 1); return { from: y, to: y } }
    case '7d': return { from: shiftDayKey(today, 6), to: today }
    case '30d': return { from: shiftDayKey(today, 29), to: today }
    case 'lifetime': return null
  }
}

/** True for a real calendar day written as 'YYYY-MM-DD' (rejects 2026-02-30 etc.). */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_KEY.test(value)) return false
  const t = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value
}

/**
 * Checks a range sent by the browser: both real days, from not after to, and
 * not starting in the future (IST). Returns an error message, or null when fine.
 */
export function rangeProblem(range: DayRange, now: Date): string | null {
  if (!isDayKey(range.from) || !isDayKey(range.to)) return 'Pick a valid date range.'
  if (range.from > range.to) return 'The start date is after the end date.'
  if (range.from > istDayKey(now)) return 'The range starts in the future.'
  return null
}

/** The exact instants for staff_money_summary's inclusive window (ISO, UTC). */
export function rangeToInstants(range: DayRange): { from: string; to: string } {
  return {
    from: new Date(`${range.from}T00:00:00.000+05:30`).toISOString(),
    to: new Date(`${range.to}T23:59:59.999+05:30`).toISOString(),
  }
}

/** A short label for a range, e.g. "7 Nov 2026" or "1 Nov – 7 Nov 2026". */
export function rangeLabel(range: DayRange | null): string {
  if (!range) return 'All time'
  const fmt = (key: string, withYear: boolean) => {
    const [y, m, d] = key.split('-').map(Number)
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
    return withYear ? `${d} ${month} ${y}` : `${d} ${month}`
  }
  if (range.from === range.to) return fmt(range.from, true)
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4)
  return `${fmt(range.from, !sameYear)} – ${fmt(range.to, true)}`
}
