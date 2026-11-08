/**
 * Player History page (superadmin + agent) -- pure filter rules, no imports,
 * tested on their own (player-history-filter.test.ts, `node --test`).
 *
 * The page asks the server for ONE game's plays, one page at a time, filtered
 * by an IST date range (lib/gameplay-range.ts), an outcome and an optional
 * round number. These are the rules both sides share.
 */

export type HistoryOutcome = 'all' | 'WON' | 'LOST'

/** Plays per page in the list. */
export const HISTORY_PAGE_SIZE = 10

export const HISTORY_OUTCOMES: ReadonlyArray<{ value: HistoryOutcome; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
]

/**
 * The round number typed in the search box, or null when the box is empty.
 * Accepts the number alone ("17418073") or the id as screens show it, with any
 * game prefix and in any case ("TC-17418073", "lc-17418073", "LC 17418073").
 * Returns 'invalid' for anything else (letters in the number, too long, ...).
 */
export function parseRoundSearch(input: string): number | null | 'invalid' {
  const s = input.trim()
  if (s === '') return null
  const m = /^(?:[a-z]{2}\s*-?\s*)?(\d{1,12})$/i.exec(s)
  if (!m) return 'invalid'
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : 'invalid'
}

/** A page number the server can use: a whole number from 1, anything else = 1. */
export function safePage(page: unknown): number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 ? page : 1
}

/** True for one of the three outcome filters. */
export function isHistoryOutcome(value: unknown): value is HistoryOutcome {
  return value === 'all' || value === 'WON' || value === 'LOST'
}
