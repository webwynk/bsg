/**
 * Tests for lucky-card.ts (the Lucky Card rules shared by every dashboard screen).
 * No test framework is installed in this project, so these use Node's built-in
 * runner (Node 24 runs .ts directly):
 *
 *   node --test src/lib/lucky-card.test.ts
 *
 * The import carries a .ts extension because Node needs it; TypeScript does not
 * allow that spelling without a compiler option the project does not set, hence
 * the expected error on that one line.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as L from './lucky-card.ts'

test('the 12 cards: ranks J Q K and four suits', () => {
  assert.deepEqual([...L.LC_RANKS], ['J', 'Q', 'K'])
  assert.deepEqual([...L.LC_SUITS], ['hearts', 'spades', 'diamonds', 'clubs'])
})

test('asRank and asSuit accept only the exact names', () => {
  for (const r of ['J', 'Q', 'K']) assert.equal(L.asRank(r), r)
  for (const s of ['hearts', 'spades', 'diamonds', 'clubs']) assert.equal(L.asSuit(s), s)
  for (const bad of ['A', 'j', 'k', '', null, undefined, 11, 'JJ']) assert.equal(L.asRank(bad), null, String(bad))
  for (const bad of ['heart', 'Hearts', 'stars', '', null, undefined, 3]) assert.equal(L.asSuit(bad), null, String(bad))
})

test('suitSymbol and suitIsRed', () => {
  assert.equal(L.suitSymbol('hearts'), '♥')
  assert.equal(L.suitSymbol('spades'), '♠')
  assert.equal(L.suitSymbol('diamonds'), '♦')
  assert.equal(L.suitSymbol('clubs'), '♣')
  assert.equal(L.suitIsRed('hearts'), true)
  assert.equal(L.suitIsRed('diamonds'), true)
  assert.equal(L.suitIsRed('spades'), false)
  assert.equal(L.suitIsRed('clubs'), false)
})

test('cardName: every one of the 12 cards', () => {
  const expected: Record<string, string> = {
    'J hearts': 'J♥', 'J spades': 'J♠', 'J diamonds': 'J♦', 'J clubs': 'J♣',
    'Q hearts': 'Q♥', 'Q spades': 'Q♠', 'Q diamonds': 'Q♦', 'Q clubs': 'Q♣',
    'K hearts': 'K♥', 'K spades': 'K♠', 'K diamonds': 'K♦', 'K clubs': 'K♣',
  }
  for (const [key, name] of Object.entries(expected)) {
    const [rank, suit] = key.split(' ')
    assert.equal(L.cardName(rank, suit), name, key)
  }
})

test('cardName: a card is whole or it is nothing', () => {
  assert.equal(L.cardName(null, null), null)
  assert.equal(L.cardName('K', null), null)
  assert.equal(L.cardName(null, 'spades'), null)
  assert.equal(L.cardName('A', 'spades'), null)
  assert.equal(L.cardName('K', 'stars'), null)
  assert.equal(L.cardName('k', 'spades'), null)
})

test('the 12 bet columns are named rank_suit in the database order', () => {
  assert.equal(L.LC_BET_COLUMNS.length, 12)
  assert.deepEqual([...L.LC_BET_COLUMNS], [
    'j_hearts', 'j_spades', 'j_diamonds', 'j_clubs',
    'q_hearts', 'q_spades', 'q_diamonds', 'q_clubs',
    'k_hearts', 'k_spades', 'k_diamonds', 'k_clubs',
  ])
})

const bet = { k_spades: 50, q_hearts: '20', j_clubs: 0, k_diamonds: null, other: 99 }

test('cardStakes: always 12 cards in column order, amounts as numbers, 0 when none', () => {
  const s = L.cardStakes(bet, 'K', 'spades')
  assert.equal(s.length, 12)
  assert.deepEqual(s.map((c: { card: string }) => c.card),
    ['J♥', 'J♠', 'J♦', 'J♣', 'Q♥', 'Q♠', 'Q♦', 'Q♣', 'K♥', 'K♠', 'K♦', 'K♣'])
  const byCard = Object.fromEntries(s.map((c: { card: string; amount: number }) => [c.card, c.amount]))
  assert.equal(byCard['K♠'], 50)
  assert.equal(byCard['Q♥'], 20)
  assert.equal(byCard['J♣'], 0)
  assert.equal(byCard['K♦'], 0)
  assert.equal(byCard['J♥'], 0)
  assert.equal(s[9].rank, 'K')
  assert.equal(s[9].suit, 'spades')
})

test('cardStakes: exactly one winner, and only when rank AND suit both match', () => {
  const winners = (rank: unknown, suit: unknown) =>
    L.cardStakes(bet, rank, suit).filter((c: { isWinner: boolean }) => c.isWinner).map((c: { card: string }) => c.card)
  assert.deepEqual(winners('K', 'spades'), ['K♠'])
  assert.deepEqual(winners('J', 'hearts'), ['J♥'])
  assert.deepEqual(winners('Q', 'clubs'), ['Q♣'])
  assert.deepEqual(winners(null, null), [])
  assert.deepEqual(winners('K', null), [])
  assert.deepEqual(winners(null, 'spades'), [])
  assert.deepEqual(winners('A', 'spades'), [])
})

test('stakedCards: only the cards bet on, with the winner marked', () => {
  const s = L.stakedCards(bet, 'K', 'spades')
  assert.deepEqual(s.map((c: { card: string; amount: number; isWinner: boolean }) => [c.card, c.amount, c.isWinner]),
    [['Q♥', 20, false], ['K♠', 50, true]])
  assert.deepEqual(L.stakedCards({ j_hearts: 1 }, null, null).map((c: { amount: number }) => c.amount), [1])
  assert.deepEqual(L.stakedCards({}, 'K', 'spades'), [])
  assert.deepEqual(L.stakedCards({ j_hearts: 0 }, null, null), [])
})

test('bonus range and validation: whole numbers 1 to 10', () => {
  assert.equal(L.LC_BONUS_MIN, 1)
  assert.equal(L.LC_BONUS_MAX, 10)
  for (let n = 1; n <= 10; n++) assert.equal(L.isValidBonus(n), true, String(n))
  for (const bad of [0, 11, -1, 2.5, NaN, Infinity, '3', null, undefined]) assert.equal(L.isValidBonus(bad), false, String(bad))
})

test('bonusLabel and bonusLabelLong', () => {
  assert.equal(L.bonusLabel(1), 'N')
  assert.equal(L.bonusLabel(2), '2X')
  assert.equal(L.bonusLabel(10), '10X')
  assert.equal(L.bonusLabelLong(1), 'N (no bonus)')
  assert.equal(L.bonusLabelLong(2), '2X')
  assert.equal(L.bonusLabelLong(7), '7X')
  assert.equal(L.bonusLabelLong(10), '10X')
})

test('embeddedCount reads PostgREST\'s [{ count }] and defaults to 0', () => {
  assert.equal(L.embeddedCount([{ count: 7 }]), 7)
  assert.equal(L.embeddedCount([{ count: '12' }]), 12)
  assert.equal(L.embeddedCount([{ count: 0 }]), 0)
  assert.equal(L.embeddedCount([]), 0)
  assert.equal(L.embeddedCount(null), 0)
  assert.equal(L.embeddedCount(undefined), 0)
})

test('paginate', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.deepEqual(L.paginate(items, 1, 4), { items: [1, 2, 3, 4], page: 1, totalPages: 3 })
  assert.deepEqual(L.paginate(items, 3, 4), { items: [9, 10], page: 3, totalPages: 3 })
  assert.deepEqual(L.paginate(items, 99, 4), { items: [9, 10], page: 3, totalPages: 3 })
  assert.deepEqual(L.paginate(items, 0, 4), { items: [1, 2, 3, 4], page: 1, totalPages: 3 })
  assert.deepEqual(L.paginate([], 1, 4), { items: [], page: 1, totalPages: 1 })
  assert.deepEqual(L.paginate([1, 2, 3, 4], 1, 4), { items: [1, 2, 3, 4], page: 1, totalPages: 1 })
})

test('relativeTime', () => {
  assert.equal(L.relativeTime(0), 'Just now')
  assert.equal(L.relativeTime(4), 'Just now')
  assert.equal(L.relativeTime(4.9), 'Just now')
  assert.equal(L.relativeTime(5), '5s ago')
  assert.equal(L.relativeTime(59), '59s ago')
  assert.equal(L.relativeTime(60), '1m ago')
  assert.equal(L.relativeTime(3599), '59m ago')
  assert.equal(L.relativeTime(3600), '1h ago')
  assert.equal(L.relativeTime(7300), '2h ago')
  assert.equal(L.relativeTime(36000), '10h ago')
  assert.equal(L.relativeTime(-10), 'Just now')
})

// ---------------------------------------------------------------------------
// A player's plays
// ---------------------------------------------------------------------------

const fmt = (iso: string) => `T(${iso})`
const betRow = {
  round_id: 'round-uuid-1',
  total_stake: '70', total_payout: '180', is_settled: true,
  created_at: '2026-10-06T18:31:00Z',
  k_spades: 50, q_hearts: 20,
  lucky_card_rounds: { round_number: '17391360', winning_rank: 'K', winning_suit: 'spades', bonus_multiplier: 3 },
}

test('playOutcome: PENDING until settled, then WON or LOST by the payout', () => {
  assert.equal(L.playOutcome(false, 500), 'PENDING')
  assert.equal(L.playOutcome(false, 0), 'PENDING')
  assert.equal(L.playOutcome(true, 1), 'WON')
  assert.equal(L.playOutcome(true, 0), 'LOST')
})

test('shapePlayerPlay: a won, settled bet', () => {
  const p = L.shapePlayerPlay(betRow, fmt)
  assert.equal(p.hand_id, 'round-uuid-1')
  assert.equal(p.round_number, 17391360)
  assert.equal(p.card, 'K♠')
  assert.equal(p.rank, 'K')
  assert.equal(p.suit, 'spades')
  assert.equal(p.bonus_multiplier, 3)
  assert.equal(p.total_stake, 70)
  assert.equal(p.total_payout, 180)
  assert.equal(p.outcome, 'WON')
  assert.equal(p.is_settled, true)
  assert.equal(p.created_at, 'T(2026-10-06T18:31:00Z)')
  assert.equal(p.created_at_iso, '2026-10-06T18:31:00Z')
  assert.equal(p.stakes.length, 12)
  assert.equal(p.picks, 'Q♥ 20 · K♠ 50')
  assert.deepEqual(p.stakes.filter((c: { isWinner: boolean }) => c.isWinner).map((c: { card: string; amount: number }) => [c.card, c.amount]), [['K♠', 50]])
})

test('shapePlayerPlay: lost, pending, undrawn round, missing numbers', () => {
  assert.equal(L.shapePlayerPlay({ ...betRow, total_payout: 0 }, fmt).outcome, 'LOST')
  assert.equal(L.shapePlayerPlay({ ...betRow, total_payout: 0, is_settled: false }, fmt).outcome, 'PENDING')
  // a settled flag without a card on the round is still PENDING (the bet cannot have a result yet)
  const undrawn = L.shapePlayerPlay({ ...betRow, lucky_card_rounds: { ...betRow.lucky_card_rounds, winning_rank: null, winning_suit: null } }, fmt)
  assert.equal(undrawn.outcome, 'PENDING')
  assert.equal(undrawn.is_settled, false)
  assert.equal(undrawn.card, null)
  assert.equal(undrawn.rank, null)
  assert.equal(undrawn.suit, null)
  assert.ok(undrawn.stakes.every((c: { isWinner: boolean }) => !c.isWinner))
  // half a card is no card: the bet is not settled either way round
  const halfA = L.shapePlayerPlay({ ...betRow, lucky_card_rounds: { ...betRow.lucky_card_rounds, winning_suit: null } }, fmt)
  const halfB = L.shapePlayerPlay({ ...betRow, lucky_card_rounds: { ...betRow.lucky_card_rounds, winning_rank: null } }, fmt)
  assert.equal(halfA.outcome, 'PENDING')
  assert.equal(halfB.outcome, 'PENDING')
  assert.equal(halfA.card, null)
  const blanks = L.shapePlayerPlay({ ...betRow, total_stake: null, total_payout: null, is_settled: null, lucky_card_rounds: { ...betRow.lucky_card_rounds, bonus_multiplier: null } }, fmt)
  assert.equal(blanks.total_stake, 0)
  assert.equal(blanks.total_payout, 0)
  assert.equal(blanks.bonus_multiplier, 1)
  assert.equal(blanks.outcome, 'PENDING')
})

test('shapePlayerPlay: a bet with no stakes has no picks text', () => {
  assert.equal(L.shapePlayerPlay({ ...betRow, k_spades: 0, q_hearts: 0 }, fmt).picks, '')
})

test('istDayKey: the Indian-time day, across midnight', () => {
  assert.equal(L.istDayKey('2026-10-06T18:29:00Z'), '2026-10-06')
  assert.equal(L.istDayKey('2026-10-06T18:31:00Z'), '2026-10-07')
  assert.equal(L.istDayKey('2026-10-07T00:00:00Z'), '2026-10-07')
})

const plays = [
  L.shapePlayerPlay({ ...betRow, created_at: '2026-10-06T18:31:00Z' }, fmt),                                  // 07 Oct IST, WON 70/180
  L.shapePlayerPlay({ ...betRow, round_id: 'r2', total_stake: 30, total_payout: 0, created_at: '2026-10-06T10:00:00Z' }, fmt), // 06 Oct IST, LOST
  L.shapePlayerPlay({ ...betRow, round_id: 'r3', total_stake: 20, total_payout: 0, is_settled: false, created_at: '2026-10-06T19:00:00Z' }, fmt), // 07 Oct IST, PENDING
]

test('filterPlays: by day and by outcome, PENDING only under "all"', () => {
  const ids = (list: Array<{ hand_id: string }>) => list.map(p => p.hand_id)
  assert.deepEqual(ids(L.filterPlays(plays, undefined, 'all')), ['round-uuid-1', 'r2', 'r3'])
  assert.deepEqual(ids(L.filterPlays(plays, '2026-10-07', 'all')), ['round-uuid-1', 'r3'])
  assert.deepEqual(ids(L.filterPlays(plays, '2026-10-06', 'all')), ['r2'])
  assert.deepEqual(ids(L.filterPlays(plays, undefined, 'WON')), ['round-uuid-1'])
  assert.deepEqual(ids(L.filterPlays(plays, undefined, 'LOST')), ['r2'])
  assert.deepEqual(ids(L.filterPlays(plays, '2026-10-07', 'LOST')), [])
  assert.deepEqual(ids(L.filterPlays(plays, '2026-10-07', 'WON')), ['round-uuid-1'])
  assert.deepEqual(L.filterPlays([], undefined, 'all'), [])
})

test('summarizePlays: settled plays only, today or lifetime', () => {
  const life = L.summarizePlays(plays, 'lifetime', '2026-10-07')
  assert.deepEqual(life, { totalPlays: 2, totalBet: 100, totalWin: 180, netGgr: -80, marginPct: -80 })
  const today = L.summarizePlays(plays, 'today', '2026-10-07')
  assert.deepEqual(today, { totalPlays: 1, totalBet: 70, totalWin: 180, netGgr: -110, marginPct: (-110 / 70) * 100 })
  const other = L.summarizePlays(plays, 'today', '2026-10-06')
  assert.deepEqual(other, { totalPlays: 1, totalBet: 30, totalWin: 0, netGgr: 30, marginPct: 100 })
  assert.deepEqual(L.summarizePlays([], 'lifetime', '2026-10-07'), { totalPlays: 0, totalBet: 0, totalWin: 0, netGgr: 0, marginPct: 0 })
  assert.deepEqual(L.summarizePlays(plays, 'today', '2026-01-01'), { totalPlays: 0, totalBet: 0, totalWin: 0, netGgr: 0, marginPct: 0 })
})
