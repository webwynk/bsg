/**
 * Tests for triple-chance-rtp.ts. Node's built-in runner (Node 24 runs .ts directly):
 *
 *   node --test src/app/superadmin/live-game/triple-chance-rtp.test.ts
 *
 * The .ts extension on the import is what Node needs; TypeScript does not allow
 * that spelling without a compiler option the project does not set.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as T from './triple-chance-rtp.ts'

test('range and quick buttons are the agreed values', () => {
  assert.equal(T.TC_RTP_MIN, 20)
  assert.equal(T.TC_RTP_MAX, 100)
  assert.equal(T.TC_RTP_STEP, 0.5)
  assert.deepEqual([...T.TC_RTP_PRESETS], [20, 30, 50, 70, 90, 95, 100])
})

test('every quick button is a valid setting', () => {
  for (const p of T.TC_RTP_PRESETS) assert.equal(T.isValidTcRtp(p), true, String(p))
})

test('20 to 100 accepted, including the old 50 and half steps', () => {
  for (const v of [20, 20.5, 30, 49.5, 50, 90, 96.5, 99.5, 100]) assert.equal(T.isValidTcRtp(v), true, String(v))
})

test('below 20 or above 100 refused', () => {
  for (const v of [19.99, 19, 0, -1, 100.01, 101]) assert.equal(T.isValidTcRtp(v), false, String(v))
})

test('non-numbers refused', () => {
  for (const v of [NaN, Infinity, -Infinity, '50', null, undefined, {}]) assert.equal(T.isValidTcRtp(v), false, String(v))
})
