/**
 * Triple Chance RTP range, shared by the Live Game slider (page.tsx) and the
 * server check in updateRtpAction (../actions.ts), so the two can never drift.
 * Tested on its own: triple-chance-rtp.test.ts (`node --test`).
 *
 * 30 to 100 since 20261107140000_tc_rtp_30_to_100.sql (was 50 to 100). The
 * database enforces the same range (CHECK on game_config and rounds). The draw
 * is unchanged: draw_round picks the result whose payout is closest to
 * round stake x RTP, so a lower setting only lowers that target.
 */
export const TC_RTP_MIN = 30
export const TC_RTP_MAX = 100
export const TC_RTP_STEP = 0.5
/** Quick buttons: the same values as Spin2Win, Lucky Card and Lucky 16. */
export const TC_RTP_PRESETS: readonly number[] = [30, 50, 70, 90, 95, 100]

/** True when `value` is a finite number from TC_RTP_MIN to TC_RTP_MAX inclusive. */
export function isValidTcRtp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= TC_RTP_MIN && value <= TC_RTP_MAX
}
