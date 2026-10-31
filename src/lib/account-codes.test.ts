/**
 * Tests for account-codes.ts (showing and finding account IDs). Uses Node's
 * built-in runner, like the other tests here:
 *
 *   node --test src/lib/account-codes.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as C from './account-codes.ts'

type Rows = { data: { user_id: string; code: string }[] | null; error: { message: string } | null }

/** A stand-in for the database that records what was asked for. */
function fakeDb(answer: Rows | Error) {
  const calls: { table: string; ids: string[] }[] = []
  const db = {
    from: (table: string) => ({
      select: () => ({
        in: async (_column: string, ids: string[]) => {
          calls.push({ table, ids })
          if (answer instanceof Error) throw answer
          return answer
        },
      }),
    }),
  }
  return { db: db as never, calls }
}

test('a missing ID shows a dash', () => {
  assert.equal(C.accountCodeLabel('R01'), 'R01')
  assert.equal(C.accountCodeLabel(null), '-')
  assert.equal(C.accountCodeLabel(undefined), '-')
  assert.equal(C.accountCodeLabel(''), '-')
})

test('search finds an ID in any case, or part of one', () => {
  assert.equal(C.accountCodeMatches('P07', 'p07'), true)
  assert.equal(C.accountCodeMatches('P07', ' P07 '), true)
  assert.equal(C.accountCodeMatches('P07', 'p0'), true)
  assert.equal(C.accountCodeMatches('P07', 'p08'), false)
})

test('an empty search or a missing ID matches nothing', () => {
  assert.equal(C.accountCodeMatches('P07', ''), false)
  assert.equal(C.accountCodeMatches('P07', '   '), false)
  assert.equal(C.accountCodeMatches(null, 'p'), false)
})

test('IDs are read only for the accounts asked about', async () => {
  const { db, calls } = fakeDb({ data: [{ user_id: 'a', code: 'R01' }, { user_id: 'b', code: 'P07' }], error: null })
  const codes = await C.fetchAccountCodes(db, ['a', 'b', 'c'])
  assert.deepEqual(calls, [{ table: 'account_codes', ids: ['a', 'b', 'c'] }])
  assert.equal(codes.get('a'), 'R01')
  assert.equal(codes.get('b'), 'P07')
  assert.equal(codes.get('c'), undefined)
})

test('no accounts means no database call', async () => {
  const { db, calls } = fakeDb({ data: [], error: null })
  assert.equal((await C.fetchAccountCodes(db, [])).size, 0)
  assert.equal(calls.length, 0)
})

test('a failed read gives no IDs and never throws', async () => {
  const quiet = console.error
  console.error = () => {}
  try {
    assert.equal((await C.fetchAccountCodes(fakeDb({ data: null, error: { message: 'x' } }).db, ['a'])).size, 0)
    assert.equal((await C.fetchAccountCodes(fakeDb(new Error('down')).db, ['a'])).size, 0)
  } finally {
    console.error = quiet
  }
})
