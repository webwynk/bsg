/**
 * Tests for sign-out-seat.ts. Node's built-in runner, as the other lib tests:
 *
 *   node --test src/lib/sign-out-seat.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import { shouldReleaseSeatOnSignOut } from './sign-out-seat.ts'

describe('shouldReleaseSeatOnSignOut', () => {
  it('frees the seat when this browser still owns it', () => {
    assert.equal(shouldReleaseSeatOnSignOut('tok', { valid: true }, false), true)
  })

  it('keeps the seat when this tab was replaced by another device', () => {
    assert.equal(shouldReleaseSeatOnSignOut('old-tok', { valid: false }, false), false)
  })

  it('keeps the seat when this browser has no session cookie', () => {
    assert.equal(shouldReleaseSeatOnSignOut(undefined, { valid: true }, false), false)
    assert.equal(shouldReleaseSeatOnSignOut('', { valid: true }, false), false)
    assert.equal(shouldReleaseSeatOnSignOut(null, null, false), false)
  })

  it('keeps the seat when the check itself failed', () => {
    assert.equal(shouldReleaseSeatOnSignOut('tok', null, true), false)
    assert.equal(shouldReleaseSeatOnSignOut('tok', { valid: true }, true), false)
  })

  it('keeps the seat on an unexpected answer shape', () => {
    assert.equal(shouldReleaseSeatOnSignOut('tok', null, false), false)
    assert.equal(shouldReleaseSeatOnSignOut('tok', { valid: 'true' }, false), false)
    assert.equal(shouldReleaseSeatOnSignOut('tok', {}, false), false)
  })
})
