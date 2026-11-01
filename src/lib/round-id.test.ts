/**
 * Tests for round-id.ts. Node's built-in runner, as the other lib tests:
 *
 *   node --test src/lib/round-id.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import { roundId, roundMatches } from './round-id.ts'

describe('roundId', () => {
  it('writes each game with its own prefix', () => {
    assert.equal(roundId('TC', 17413022), 'TC-17413022')
    assert.equal(roundId('LC', 17413022), 'LC-17413022')
    assert.equal(roundId('SW', 17935360), 'SW-17935360')
    assert.equal(roundId('LS', 17413022), 'LS-17413022')
  })
})

describe('roundMatches', () => {
  it('finds a round with or without the prefix', () => {
    assert.equal(roundMatches('TC', 17413022, '17413022'), true)
    assert.equal(roundMatches('TC', 17413022, 'tc-17413022'), true)
    assert.equal(roundMatches('TC', 17413022, ' 3022 '), true)
  })

  it('does not find another game or an empty search', () => {
    assert.equal(roundMatches('TC', 17413022, 'LC-17413022'), false)
    assert.equal(roundMatches('TC', 17413022, ''), false)
  })
})
