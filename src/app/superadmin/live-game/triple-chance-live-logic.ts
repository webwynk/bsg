/**
 * Pure helpers for the Live Game "Triple Chance" tab (triple-chance-live.tsx).
 * No React, no server calls, so they can be unit-tested with Node's runner.
 */

/** Triple Chance's full server cycle, in seconds (tick_rounds / get_current_round). */
export const TC_CYCLE_SECONDS = 103

/**
 * The second of the current round right now, counted locally from the last
 * server read: the seconds_into get_current_round returned, plus the whole
 * seconds that have passed since that read arrived. Capped at the 103 s cycle
 * (not wrapped), so once a round's time is up the page stays at "betting
 * closed" until the next server read (every 3 s, or at once on a Realtime
 * round change) brings the new round. Null when there is no round yet.
 *
 * Since 2026-11-15 (dashboard server-call optimisation step 3) this feeds both
 * the "Cycle Phase" line and the RTP / bonus lock countdown, replacing the
 * separate 2 s getActiveRoundTimingAction poll the countdown used before.
 */
export function tcSecondsInto(
  fetchedSecondsInto: number | null | undefined,
  fetchedAt: number,
  now: number
): number | null {
  if (fetchedSecondsInto === null || fetchedSecondsInto === undefined) return null
  const elapsed = fetchedAt > 0 && now > fetchedAt ? Math.floor((now - fetchedAt) / 1000) : 0
  return Math.min(TC_CYCLE_SECONDS, fetchedSecondsInto + elapsed)
}
