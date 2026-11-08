/**
 * Tests for player-history-filter.ts. Node's built-in runner (Node 24 runs .ts directly):
 *   node --test src/lib/player-history-filter.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as F from './player-history-filter.ts'

test('round search accepts the number or the id as screens show it', () => {
  assert.equal(F.parseRoundSearch(''), null)
  assert.equal(F.parseRoundSearch('   '), null)
  assert.equal(F.parseRoundSearch('17418073'), 17418073)
  assert.equal(F.parseRoundSearch('TC-17418073'), 17418073)
  assert.equal(F.parseRoundSearch('lc-17418073'), 17418073)
  assert.equal(F.parseRoundSearch('SW 17940571'), 17940571)
  assert.equal(F.parseRoundSearch(' LS-17418039 '), 17418039)
})

test('round search refuses anything else', () => {
  for (const bad of ['abc', 'TC-', 'TC-12a', '12.5', '-5', '0', 'TCX-123', '1234567890123', 'TC--1']) {
    assert.equal(F.parseRoundSearch(bad), 'invalid', bad)
  }
})

test('page numbers and outcomes', () => {
  assert.equal(F.safePage(3), 3)
  for (const bad of [0, -1, 1.5, NaN, '2', null, undefined]) assert.equal(F.safePage(bad), 1, String(bad))
  for (const ok of ['all', 'WON', 'LOST']) assert.equal(F.isHistoryOutcome(ok), true)
  for (const bad of ['won', 'PENDING', '', null]) assert.equal(F.isHistoryOutcome(bad), false)
  assert.deepEqual(F.HISTORY_OUTCOMES.map((o: { value: string }) => o.value), ['all', 'WON', 'LOST'])
})
