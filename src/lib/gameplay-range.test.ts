/**
 * Tests for gameplay-range.ts. Node's built-in runner (Node 24 runs .ts directly):
 *   node --test src/lib/gameplay-range.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as R from './gameplay-range.ts'

// 2026-11-07 22:00 IST = 16:30 UTC; 2026-11-07 00:10 IST = 2026-11-06 18:40 UTC.
const LATE = new Date('2026-11-07T16:30:00Z')
const JUST_AFTER_MIDNIGHT_IST = new Date('2026-11-06T18:40:00Z')
const JUST_BEFORE_MIDNIGHT_IST = new Date('2026-11-06T18:29:59Z')

test('istDayKey uses India time, not UTC', () => {
  assert.equal(R.istDayKey(LATE), '2026-11-07')
  assert.equal(R.istDayKey(JUST_AFTER_MIDNIGHT_IST), '2026-11-07') // still the 6th in UTC
  assert.equal(R.istDayKey(JUST_BEFORE_MIDNIGHT_IST), '2026-11-06')
})

test('presets count back whole IST days', () => {
  assert.deepEqual(R.presetRange('today', LATE), { from: '2026-11-07', to: '2026-11-07' })
  assert.deepEqual(R.presetRange('yesterday', LATE), { from: '2026-11-06', to: '2026-11-06' })
  assert.deepEqual(R.presetRange('7d', LATE), { from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(R.presetRange('30d', LATE), { from: '2026-10-09', to: '2026-11-07' })
  assert.equal(R.presetRange('lifetime', LATE), null)
  assert.deepEqual(R.presetRange('today', JUST_AFTER_MIDNIGHT_IST), { from: '2026-11-07', to: '2026-11-07' })
})

test('month, year and leap-day edges', () => {
  assert.equal(R.shiftDayKey('2026-03-01', 1), '2026-02-28')
  assert.equal(R.shiftDayKey('2028-03-01', 1), '2028-02-29')
  assert.equal(R.shiftDayKey('2027-01-01', 1), '2026-12-31')
  assert.deepEqual(R.presetRange('7d', new Date('2027-01-02T06:00:00Z')), { from: '2026-12-27', to: '2027-01-02' })
})

test('a range becomes inclusive IST instants', () => {
  assert.deepEqual(R.rangeToInstants({ from: '2026-11-07', to: '2026-11-07' }), {
    from: '2026-11-06T18:30:00.000Z',
    to: '2026-11-07T18:29:59.999Z',
  })
  assert.deepEqual(R.rangeToInstants({ from: '2026-11-01', to: '2026-11-07' }), {
    from: '2026-10-31T18:30:00.000Z',
    to: '2026-11-07T18:29:59.999Z',
  })
})

test('isDayKey accepts only real days', () => {
  for (const ok of ['2026-11-07', '2028-02-29', '2026-12-31']) assert.equal(R.isDayKey(ok), true, ok)
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-11-7', '07-11-2026', '', null, 20261107, '2026-11-07T00:00']) {
    assert.equal(R.isDayKey(bad), false, String(bad))
  }
})

test('rangeProblem refuses bad, reversed and future ranges', () => {
  assert.equal(R.rangeProblem({ from: '2026-11-01', to: '2026-11-07' }, LATE), null)
  assert.equal(R.rangeProblem({ from: '2026-11-07', to: '2026-11-07' }, LATE), null)
  assert.match(R.rangeProblem({ from: '2026-11-08', to: '2026-11-07' }, LATE) ?? '', /after the end/)
  assert.match(R.rangeProblem({ from: '2026-11-08', to: '2026-11-09' }, LATE) ?? '', /future/)
  assert.match(R.rangeProblem({ from: 'x', to: '2026-11-07' }, LATE) ?? '', /valid/)
})

test('labels', () => {
  assert.equal(R.rangeLabel(null), 'All time')
  assert.equal(R.rangeLabel({ from: '2026-11-07', to: '2026-11-07' }), '7 Nov 2026')
  assert.equal(R.rangeLabel({ from: '2026-11-01', to: '2026-11-07' }), '1 Nov – 7 Nov 2026')
  assert.equal(R.rangeLabel({ from: '2026-12-28', to: '2027-01-03' }), '28 Dec 2026 – 3 Jan 2027')
})

test('the preset list is Today, Yesterday, 7 days, 30 days, Lifetime', () => {
  assert.deepEqual(R.GAMEPLAY_PRESETS.map((p: { value: string }) => p.value), ['today', 'yesterday', '7d', '30d', 'lifetime'])
})
