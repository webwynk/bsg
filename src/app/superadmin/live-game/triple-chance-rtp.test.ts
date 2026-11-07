/**
 * Tests for triple-chance-rtp.ts. Node's built-in runner (Node 24 runs .ts directly):
 *   node --test src/app/superadmin/live-game/triple-chance-rtp.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as T from './triple-chance-rtp.ts'

test('range is 30 to 100 in steps of 0.5, buttons like the other games', () => {
  assert.equal(T.TC_RTP_MIN, 30)
  assert.equal(T.TC_RTP_MAX, 100)
  assert.equal(T.TC_RTP_STEP, 0.5)
  assert.deepEqual([...T.TC_RTP_PRESETS], [30, 50, 70, 90, 95, 100])
})

test('every quick button is a valid setting', () => {
  for (const p of T.TC_RTP_PRESETS) assert.equal(T.isValidTcRtp(p), true, String(p))
})

test('30, 35, 49.5 and 100 are accepted', () => {
  for (const v of [30, 35, 49.5, 100]) assert.equal(T.isValidTcRtp(v), true, String(v))
})

test('below 30, above 100 and non-numbers are refused', () => {
  for (const v of [29.99, 20, 0, -1, 100.01, 150, NaN, Infinity, '50', null, undefined]) {
    assert.equal(T.isValidTcRtp(v), false, String(v))
  }
})
