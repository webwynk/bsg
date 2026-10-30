/**
 * Tests for lucky16.ts (the Lucky 16 Card rules of the dashboard screens). No
 * test framework is installed in this project, so these use Node's built-in
 * runner (Node 24 runs .ts directly):
 *
 *   node --test src/lib/lucky16.test.ts
 *
 * The import carries a .ts extension because Node needs it; TypeScript does not
 * allow that spelling without a compiler option the project does not set, hence
 * the expected error on that one line.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as L from './lucky16.ts'

test('the 16 cards: ranks A J Q K and four suits', () => {
  assert.deepEqual([...L.L16_RANKS], ['A', 'J', 'Q', 'K'])
  assert.deepEqual([...L.L16_SUITS], ['hearts', 'spades', 'diamonds', 'clubs'])
  assert.equal(L.L16_BET_COLUMNS.length, 16)
  assert.equal(L.L16_BET_COLUMNS[0], 'a_hearts')
  assert.equal(L.L16_BET_COLUMNS[15], 'k_clubs')
})

test('asRank and asSuit accept only the exact names', () => {
  for (const r of ['A', 'J', 'Q', 'K']) assert.equal(L.asRank(r), r)
  for (const bad of ['a', 'T', '', null, undefined, 11]) assert.equal(L.asRank(bad), null, String(bad))
  for (const bad of ['Hearts', 'stars', '', null]) assert.equal(L.asSuit(bad), null, String(bad))
})

test('cardName needs both parts', () => {
  assert.equal(L.cardName('A', 'spades'), 'A♠')
  assert.equal(L.cardName('A', null), null)
  assert.equal(L.cardName(null, 'spades'), null)
})

test('cardStakes marks the winner only when rank and suit both match', () => {
  const cards = L.cardStakes({ a_hearts: 50, k_clubs: '20' }, 'K', 'clubs')
  assert.equal(cards.length, 16)
  assert.equal(cards[0].amount, 50)
  assert.equal(cards[15].amount, 20)
  assert.deepEqual(cards.filter((c: { isWinner: boolean }) => c.isWinner).map((c: { card: string }) => c.card), ['K♣'])
  assert.equal(L.stakedCards({ a_hearts: 50 }, null, null).length, 1)
})

test('cardTotals adds up every bet per card; rubbish counts as 0', () => {
  const cards = L.cardTotals([{ a_hearts: 50, j_spades: 5 }, { a_hearts: '25', j_spades: 'x' }], null, null)
  assert.equal(cards.length, 16)
  assert.equal(cards[0].amount, 75)
  assert.equal(cards[5].card, 'J♠')
  assert.equal(cards[5].amount, 5)
  assert.ok(cards.every((c: { isWinner: boolean }) => !c.isWinner), 'nothing wins before the draw')
})

test('cardTotals with no bets is sixteen empty cards, and marks the drawn card', () => {
  assert.ok(L.cardTotals(null, null, null).every((c: { amount: number }) => c.amount === 0))
  const won = L.cardTotals([], 'A', 'diamonds').filter((c: { isWinner: boolean }) => c.isWinner)
  assert.deepEqual(won.map((c: { card: string }) => c.card), ['A♦'])
})

test('a win pays stake x 14 x bonus; the limit lines are 140,000 and 1,400,000', () => {
  assert.equal(L.L16_PAYOUT_MULTIPLIER, 14)
  assert.equal(L.cardPayout(5, 1), 70)
  assert.equal(L.cardPayout(5, 2), 140)
  assert.equal(L.limitPayout(1), 140_000)
  assert.equal(L.limitPayout(10), 1_400_000)
})

test('biggestExposure is the card with the most coins, at the bonus given', () => {
  const cards = L.cardTotals([{ q_hearts: 100, k_clubs: 300 }], null, null)
  assert.deepEqual(L.biggestExposure(cards, 3), { card: 'K♣', payout: 12_600 })
  assert.equal(L.biggestExposure(L.cardTotals(null, null, null), 3), null)
})

test('bonus: whole numbers 1 to 10, N for 1', () => {
  for (const ok of [1, 2, 10]) assert.equal(L.isValidBonus(ok), true)
  for (const bad of [0, 11, 1.5, '2', null, NaN]) assert.equal(L.isValidBonus(bad), false, String(bad))
  assert.equal(L.bonusLabel(1), 'N')
  assert.equal(L.bonusLabel(10), '10X')
  assert.equal(L.bonusLabelLong(1), 'N (no bonus)')
})

const betRow = {
  round_id: 'round-1', a_spades: 50, k_clubs: 20, total_stake: 70, total_payout: 700, is_settled: true,
  created_at: '2026-10-30T10:00:00+00:00',
  lucky16_rounds: { round_number: '17403942', winning_rank: 'A', winning_suit: 'spades', bonus_multiplier: 1 },
}

test('shapePlayerPlay: the card, the sixteen stakes, the picks and the outcome', () => {
  const p = L.shapePlayerPlay(betRow, () => 'shown')
  assert.equal(p.hand_id, 'round-1')
  assert.equal(p.round_number, 17403942)
  assert.equal(p.card, 'A♠')
  assert.equal(p.stakes.length, 16)
  assert.equal(p.picks, 'A♠ 50 · K♣ 20')
  assert.equal(p.outcome, 'WON')
  assert.equal(p.created_at, 'shown')
})

test('shapePlayerPlay: a bet with no drawn card is PENDING, however it is marked', () => {
  const open = { ...betRow, lucky16_rounds: { ...betRow.lucky16_rounds, winning_rank: null, winning_suit: null } }
  const p = L.shapePlayerPlay(open, () => '')
  assert.equal(p.outcome, 'PENDING')
  assert.equal(p.card, null)
  assert.equal(L.playOutcome(true, 0), 'LOST')
})

test('filterPlays and summarizePlays: Indian days, settled plays only', () => {
  const won = L.shapePlayerPlay(betRow, () => '')
  const pending = { ...won, outcome: 'PENDING' as const }
  assert.equal(L.istDayKey('2026-10-30T19:00:00Z'), '2026-10-31')
  assert.equal(L.filterPlays([won, pending], undefined, 'all').length, 2)
  assert.equal(L.filterPlays([won, pending], undefined, 'WON').length, 1)
  assert.equal(L.filterPlays([won, pending], '2026-10-29', 'all').length, 0)
  const s = L.summarizePlays([won, pending], 'lifetime', '2026-10-30')
  assert.equal(s.totalPlays, 1)
  assert.equal(s.netGgr, -630)
  assert.equal(L.summarizePlays([won], 'today', '2026-10-29').totalPlays, 0)
})

test('paginate keeps the page inside the list', () => {
  assert.deepEqual(L.paginate([1, 2, 3], 9, 2), { items: [3], page: 2, totalPages: 2 })
  assert.deepEqual(L.paginate([], 1, 2), { items: [], page: 1, totalPages: 1 })
})
