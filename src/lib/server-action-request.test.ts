/**
 * Tests for server-action-request.ts. Node's built-in runner, as the other lib tests:
 *
 *   node --test src/lib/server-action-request.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import { isServerActionRequest } from './server-action-request.ts'

describe('isServerActionRequest', () => {
  it('is true for a POST carrying the next-action header (a server action call)', () => {
    assert.equal(isServerActionRequest('POST', new Headers({ 'next-action': 'abc123' })), true)
  })

  it('reads the header name case-insensitively, as browsers send it', () => {
    assert.equal(isServerActionRequest('POST', new Headers({ 'Next-Action': 'abc123' })), true)
  })

  it('is false for a normal page open (GET)', () => {
    assert.equal(isServerActionRequest('GET', new Headers()), false)
  })

  it('is false for a GET even if it carries the header (navigations stay checked)', () => {
    assert.equal(isServerActionRequest('GET', new Headers({ 'next-action': 'abc123' })), false)
  })

  it('is false for a client-side navigation / prefetch (RSC header, no next-action)', () => {
    assert.equal(isServerActionRequest('GET', new Headers({ rsc: '1', 'next-router-prefetch': '1' })), false)
  })

  it('is false for a POST without the header', () => {
    assert.equal(isServerActionRequest('POST', new Headers()), false)
  })

  it('accepts a lower-case method too', () => {
    assert.equal(isServerActionRequest('post', new Headers({ 'next-action': 'x' })), true)
  })
})
