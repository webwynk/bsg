/**
 * Tests for desktop-players.ts. Node's built-in runner, as the other lib tests:
 *
 *   node --test src/lib/desktop-players.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import { cleanDesktopSearch, printSwitchError, scopeToAgent } from './desktop-players.ts'

describe('cleanDesktopSearch', () => {
  it('keeps names, usernames and IDs', () => {
    assert.equal(cleanDesktopSearch('  player_99 '), 'player_99')
    assert.equal(cleanDesktopSearch('P17'), 'P17')
    assert.equal(cleanDesktopSearch('Mir Hasan'), 'Mir Hasan')
    assert.equal(cleanDesktopSearch('মির'), 'মির')
  })

  it('removes what has meaning inside a filter', () => {
    assert.equal(cleanDesktopSearch('a,b(c)"d%e*'), 'abcde')
    assert.equal(cleanDesktopSearch('x,role.eq.agent'), 'xrole.eq.agent')
  })

  it('handles nothing and very long text', () => {
    assert.equal(cleanDesktopSearch(undefined), '')
    assert.equal(cleanDesktopSearch('a'.repeat(80)).length, 50)
  })
})

describe('scopeToAgent', () => {
  const fakeQuery = () => {
    const calls: Array<[string, string]> = []
    const query = {
      calls,
      eq(column: 'agent_id', value: string) {
        calls.push([column, value])
        return query
      },
    }
    return query
  }

  it('limits an agent to their own players', () => {
    const query = fakeQuery()
    assert.equal(scopeToAgent(query, 'agent-1'), query)
    assert.deepEqual(query.calls, [['agent_id', 'agent-1']])
  })

  it('leaves the superadmin unlimited', () => {
    const query = fakeQuery()
    scopeToAgent(query, null)
    assert.deepEqual(query.calls, [])
  })
})

describe('printSwitchError', () => {
  it('says too soon, and names the 103 seconds', () => {
    const text = printSwitchError('P0156', 'player99')
    assert.match(text, /Too soon/)
    assert.match(text, /103 seconds/)
    assert.match(text, /@player99/)
  })

  it('explains each refusal', () => {
    assert.match(printSwitchError('P0151', 'a'), /no player ID/)
    assert.match(printSwitchError('P0150', 'a'), /not a player/)
    assert.match(printSwitchError('P0135', 'a'), /Only the superadmin/)
  })

  it('never shows a raw database message', () => {
    assert.equal(printSwitchError('XX000', 'a'), 'Could not change Print for @a. Please try again.')
    assert.equal(printSwitchError(undefined, 'a'), 'Could not change Print for @a. Please try again.')
  })
})
