/**
 * Tests for triple-chance-live-logic.ts. Node's built-in runner:
 *   node --test src/app/superadmin/live-game/triple-chance-live-logic.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import { tcSecondsInto, TC_CYCLE_SECONDS } from './triple-chance-live-logic.ts'

test('cycle is 103 s', () => {
  assert.equal(TC_CYCLE_SECONDS, 103)
})

test('no round yet -> null', () => {
  assert.equal(tcSecondsInto(null, 1_000, 5_000), null)
  assert.equal(tcSecondsInto(undefined, 1_000, 5_000), null)
})

test('right after the read it is the server value', () => {
  assert.equal(tcSecondsInto(40, 10_000, 10_000), 40)
})

test('counts whole seconds since the read', () => {
  assert.equal(tcSecondsInto(40, 10_000, 12_999), 42)
  assert.equal(tcSecondsInto(40, 10_000, 13_000), 43)
})

test('stops at the end of the cycle instead of wrapping', () => {
  assert.equal(tcSecondsInto(100, 10_000, 20_000), 103)
})

test('no read time yet or clock behind the read -> server value', () => {
  assert.equal(tcSecondsInto(55, 0, 99_000), 55)
  assert.equal(tcSecondsInto(55, 10_000, 9_000), 55)
})

test('matches the old lock rules: countdown 90 - s, RTP lock at <= 12, boost lock at >= 75', () => {
  const s = tcSecondsInto(70, 1_000, 9_000) // 78
  assert.equal(s, 78)
  const countdown = Math.max(0, Math.min(90, 90 - (s as number)))
  assert.equal(countdown, 12)
  assert.equal(countdown <= 12, true)
  assert.equal((s as number) >= 75, true)
})
