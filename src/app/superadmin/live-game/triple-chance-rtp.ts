/**
 * Triple Chance -- the RTP range for the Live Game "Triple Chance" tab.
 *
 * No React, no database: plain values and one check, so they can be tested on
 * their own (triple-chance-rtp.test.ts, run with `node --test`) and shared by
 * the slider (page.tsx) and the server action that saves it
 * (updateRtpAction in ../actions.ts).
 *
 * 20 to 100 since the Triple Chance Fair draw v2 install
 * (20261106110000_tc_fair_draw_v2.sql), which widened the database checks
 * game_config_rtp_percentage_check and rounds_rtp_percentage_check from 50 to 20.
 * The database still enforces the range; this check only gives a friendly message.
 * Same range and quick buttons as Spin2Win (spin2win-live-logic.ts).
 */

export const TC_RTP_MIN = 20
export const TC_RTP_MAX = 100
export const TC_RTP_STEP = 0.5
export const TC_RTP_PRESETS: readonly number[] = [20, 30, 50, 70, 90, 95, 100]

/** True only for a number from 20 to 100 inclusive. NaN and Infinity fail the range test. */
export function isValidTcRtp(value: unknown): value is number {
  return typeof value === 'number' && value >= TC_RTP_MIN && value <= TC_RTP_MAX
}
