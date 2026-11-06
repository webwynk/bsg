/**
 * Tests for player-tickets.ts. Node's built-in runner, as the other lib tests:
 *
 *   node --test src/lib/player-tickets.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import { groupTicketsByRound, loadPlayerTickets, ticketSummary, ticketTokens, type PlayerTicket, type PlayerTicketDeps } from './player-tickets.ts'

const ticket = (round_number: number, ticket_no: number): PlayerTicket => ({
  ticket_code: `LS-P17-${ticket_no}`, ticket_no, round_number, total_stake: 10, is_drawn: true, win: 0, items: {},
})

/** The same rule as assertOwnership: an agent only reaches their own players. */
function deps(reads: unknown[][]): PlayerTicketDeps {
  return {
    resolvePlayerId: async id => (id === 'nobody' ? null : id),
    assertOwnership: async (caller, playerId) =>
      caller.role === 'superadmin' || playerId === `player-of-${caller.id}`
        ? { ok: true }
        : { ok: false, error: 'Unauthorized: that player belongs to another agent.' },
    readTickets: async (playerId, game, rounds) => {
      reads.push([playerId, game, rounds])
      return [ticket(5, 1), ticket(5, 2), ticket(6, 3)]
    },
  }
}

describe('loadPlayerTickets', () => {
  it('lets an agent read their own player', async () => {
    const reads: unknown[][] = []
    const res = await loadPlayerTickets({ id: 'a1', role: 'agent' }, 'player-of-a1', 'LS', [5, 6], deps(reads))
    assert.equal(res.error, null)
    assert.equal(res.tickets[5].length, 2)
    assert.deepEqual(reads, [['player-of-a1', 'LS', [5, 6]]])
  })

  it("refuses another agent's player, without reading a ticket", async () => {
    const reads: unknown[][] = []
    const res = await loadPlayerTickets({ id: 'a1', role: 'agent' }, 'player-of-a2', 'LS', [5], deps(reads))
    assert.match(res.error ?? '', /another agent/)
    assert.deepEqual(res.tickets, {})
    assert.deepEqual(reads, [])
  })

  it('lets the superadmin read any player', async () => {
    const res = await loadPlayerTickets({ id: 's', role: 'superadmin' }, 'player-of-a2', 'TC', [5], deps([]))
    assert.equal(res.error, null)
  })

  it('refuses an unknown game and an unknown player', async () => {
    const reads: unknown[][] = []
    const admin = { id: 's', role: 'superadmin' }
    assert.equal((await loadPlayerTickets(admin, 'p', 'XX' as 'LS', [5], deps(reads))).error, 'Unknown game.')
    assert.equal((await loadPlayerTickets(admin, 'nobody', 'LS', [5], deps(reads))).error, 'Player not found.')
    assert.deepEqual(reads, [])
  })

  it('does not read when there are no rounds, and asks for each round once', async () => {
    const reads: unknown[][] = []
    const admin = { id: 's', role: 'superadmin' }
    assert.deepEqual(await loadPlayerTickets(admin, 'p', 'LS', [], deps(reads)), { tickets: {}, error: null })
    assert.deepEqual(reads, [])
    await loadPlayerTickets(admin, 'p', 'LS', [5, 5, 1.5, 6], deps(reads))
    assert.deepEqual(reads[0][2], [5, 6])
  })

  it('caps how many rounds one read asks for', async () => {
    const reads: unknown[][] = []
    const many = Array.from({ length: 150 }, (_, i) => i)
    await loadPlayerTickets({ id: 's', role: 'superadmin' }, 'p', 'LS', many, deps(reads))
    assert.equal((reads[0][2] as number[]).length, 100)
  })

  it('reports a failed read', async () => {
    const failing = { ...deps([]), readTickets: async () => { throw new Error('down') } }
    const res = await loadPlayerTickets({ id: 's', role: 'superadmin' }, 'p', 'LS', [5], failing)
    assert.equal(res.error, 'Could not load tickets: down')
  })
})

describe('ticket contents', () => {
  const plain = (n: number) => String(n)

  it('orders cards: smallest amount, then suit, then rank', () => {
    const items = { k_clubs: 5, a_hearts: 5, q_spades: 5, j_spades: 5, k_hearts: 1, a_spades: 0 }
    assert.equal(ticketSummary('LS', items, plain), 'K♥ 1 · J♠ 5 · Q♠ 5 · A♥ 5 · K♣ 5')
  })

  it('orders Spin2Win numbers the same way', () => {
    assert.equal(ticketSummary('SW', { n7: 50, n3: 50, n0: 5 }, plain), '0: 5 · 3: 50 · 7: 50')
  })

  it('groups Triple Chance like the printed ticket', () => {
    const items = { single: { 7: 5, 2: 5, 6: 5, 4: 500, 9: 500 }, double: { 5: 10 }, triple: {} }
    assert.equal(ticketSummary('TC', items, plain), 'SINGLE: 2, 6, 7 (5) | 4, 9 (500)\nDOUBLE: 05 (10)')
  })

  it('leaves out what it does not know', () => {
    assert.deepEqual(ticketTokens('LC', { nope: 5, n3: 5 }, plain), [])
    assert.deepEqual(ticketTokens('TC', {}, plain), [])
  })
})

describe('groupTicketsByRound', () => {
  it('keeps each round together, in the order given', () => {
    const rounds = groupTicketsByRound([ticket(5, 1), ticket(6, 2), ticket(5, 3)])
    assert.deepEqual(rounds[5].map(t => t.ticket_no), [1, 3])
    assert.deepEqual(rounds[6].map(t => t.ticket_no), [2])
  })
})
