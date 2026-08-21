/**
 * Issue #90 fix.
 *
 * A day picked on a `Calendar` widget (react-day-picker) has no real
 * corresponding instant -- the widget builds it as local midnight in
 * whatever timezone the browser happens to be in (`new Date(year, month,
 * day)`). Converting that instant into "what day is this in IST" (via
 * `toLocaleDateString(..., { timeZone: 'Asia/Kolkata' })` or `toISOString()`
 * re-derived server-side) answers the wrong question: for any browser east
 * of IST by more than +5:30 (Bangkok, Singapore, China, Japan, Korea,
 * Australia, NZ), local midnight of the picked day already falls on the
 * PREVIOUS IST calendar day, so the "correct" IST conversion of that instant
 * silently returns the wrong date.
 *
 * pickedDayKey() sidesteps the ambiguity instead of resolving it: it reads
 * back exactly the year/month/day the widget was given, in the same local
 * frame it was constructed in, with no timezone conversion at all. That is
 * an exact, unambiguous round trip of what the user actually clicked,
 * regardless of the browser's timezone.
 *
 * Do NOT use this on a real "now" Date (e.g. a "Today" quick-button) -- that
 * is a genuine instant, and correctly answering "what day is it in India
 * right now" requires the timezone-aware conversion this function
 * deliberately avoids. Use `new Date().toLocaleDateString('en-CA', {
 * timeZone: 'Asia/Kolkata' })` for that case instead, same as the rest of
 * this codebase's "today" logic already does correctly.
 */
export function pickedDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
