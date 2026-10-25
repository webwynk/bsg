/**
 * Tests for spin2win.ts (the Spin2Win rules shared by every dashboard screen).
 * No test framework is installed in this project, so these use Node's built-in
 * runner (Node 24 runs .ts directly):
 *
 *   node --test src/lib/spin2win.test.ts
 *
 * The import carries a .ts extension because Node needs it; TypeScript does not
 * allow that spelling without a compiler option the project does not set, hence
 * the expected error on that one line.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error TS5097: Node's runner needs the .ts extension on a relative import.
import * as S from './spin2win.ts'

test('the ten numbers and their stake columns', () => {
  assert.deepEqual([...S.S2W_NUMBERS], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual([...S.S2W_BET_COLUMNS], ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'])
})

test('asWinningNumber accepts only whole numbers 0 to 9', () => {
  for (const n of [0, 5, 9]) assert.equal(S.asWinningNumber(n), n)
  assert.equal(S.asWinningNumber('7'), 7)
  for (const bad of [null, undefined, '', -1, 10, 2.5, 'x', NaN]) assert.equal(S.asWinningNumber(bad), null, String(bad))
})

test('numberColor: the app palette, grey outside 0..9', () => {
  assert.equal(S.numberColor(0), '#00C8F0')
  assert.equal(S.numberColor(1), '#FF3155')
  assert.equal(S.numberColor(6), '#FF3155')
  assert.equal(S.numberColor(7), '#FFB52E')
  assert.equal(S.numberColor(9), '#FF35C7')
  assert.equal(S.numberColor(10), '#6B7280')
  for (const n of S.S2W_NUMBERS) assert.match(S.numberColor(n), /^#[0-9A-F]{6}$/)
})

test('numberStakes: all ten in order, winner marked only with a result', () => {
  const row = { n0: 0, n2: '50', n9: 10 }
  const all = S.numberStakes(row, 2)
  assert.equal(all.length, 10)
  assert.deepEqual(all[2], { number: 2, amount: 50, isWinner: true })
  assert.deepEqual(all[3], { number: 3, amount: 0, isWinner: false })
  assert.equal(S.numberStakes(row, null).some(s => s.isWinner), false)
})

test('stakedNumbers keeps only the numbers with coins', () => {
  const row = { n1: 5, n4: 0, n8: 100 }
  assert.deepEqual(S.stakedNumbers(row, 8).map(s => [s.number, s.amount, s.isWinner]), [[1, 5, false], [8, 100, true]])
  assert.deepEqual(S.stakedNumbers({}, null), [])
})

test('bonus range 1 to 4, whole numbers only', () => {
  assert.equal(S.S2W_BONUS_MIN, 1)
  assert.equal(S.S2W_BONUS_MAX, 4)
  for (const b of [1, 2, 3, 4]) assert.equal(S.isValidBonus(b), true)
  for (const bad of [0, 5, 2.5, '2', null, NaN]) assert.equal(S.isValidBonus(bad), false, String(bad))
})

test('bonus labels: N and lower-case x', () => {
  assert.equal(S.bonusLabel(1), 'N')
  assert.equal(S.bonusLabel(2), '2x')
  assert.equal(S.bonusLabel(4), '4x')
  assert.equal(S.bonusLabelLong(1), 'N (no bonus)')
  assert.equal(S.bonusLabelLong(3), '3x')
})

test('bonusColors: the app shades, N for anything else', () => {
  assert.deepEqual(S.bonusColors(1), { light: '#C7D3EE', dark: '#5A6A8E' })
  assert.deepEqual(S.bonusColors(2), { light: '#6FF3FF', dark: '#0077A8' })
  assert.deepEqual(S.bonusColors(3), { light: '#7DFFAE', dark: '#0A9A45' })
  assert.deepEqual(S.bonusColors(4), { light: '#6FB0FF', dark: '#0A4FC4' })
  assert.deepEqual(S.bonusColors(9), S.bonusColors(1))
})

test('betPayout: stake on the winner x 9 x bonus', () => {
  const row = { n2: 5, n3: 20 }
  assert.equal(S.betPayout(row, 2, 1), 45)
  assert.equal(S.betPayout(row, 2, 2), 90)
  assert.equal(S.betPayout(row, 2, 3), 135)
  assert.equal(S.betPayout(row, 7, 4), 0)
  assert.equal(S.betPayout(row, null, 4), 0)
})

test('embeddedCount', () => {
  assert.equal(S.embeddedCount([{ count: 3 }]), 3)
  assert.equal(S.embeddedCount([{ count: '12' }]), 12)
  assert.equal(S.embeddedCount([]), 0)
  assert.equal(S.embeddedCount(null), 0)
  assert.equal(S.embeddedCount(undefined), 0)
})

test('paginate keeps the page in range', () => {
  const items = Array.from({ length: 17 }, (_, i) => i)
  assert.deepEqual(S.paginate(items, 1, 8), { items: [0, 1, 2, 3, 4, 5, 6, 7], page: 1, totalPages: 3 })
  assert.deepEqual(S.paginate(items, 3, 8), { items: [16], page: 3, totalPages: 3 })
  assert.equal(S.paginate(items, 99, 8).page, 3)
  assert.equal(S.paginate(items, 0, 8).page, 1)
  assert.deepEqual(S.paginate([], 1, 8), { items: [], page: 1, totalPages: 1 })
})

test('relativeTime wording', () => {
  assert.equal(S.relativeTime(-3), 'Just now')
  assert.equal(S.relativeTime(4.9), 'Just now')
  assert.equal(S.relativeTime(12), '12s ago')
  assert.equal(S.relativeTime(185), '3m ago')
  assert.equal(S.relativeTime(7300), '2h ago')
})

// ---------------------------------------------------------------------------
// A player's plays (player-history screens)
// ---------------------------------------------------------------------------

function betRow(over: Record<string, unknown> = {}, round: Record<string, unknown> = {}) {
  return {
    round_id: 'r-1',
    n0: 0, n1: 0, n2: 0, n3: '50', n4: 0, n5: 0, n6: 0, n7: 20, n8: 0, n9: 0,
    total_stake: '70',
    total_payout: 0,
    is_settled: false,
    created_at: '2026-10-25T06:30:00Z',
    ...over,
    spin2win_rounds: { round_number: '1042', winning_number: null, bonus_multiplier: 1, ...round },
  } as S.PlayerSpin2WinBetRow
}

const fmt = (iso: string) => `T:${iso}`

test('shapePlayerPlay: a pending bet', () => {
  const p = S.shapePlayerPlay(betRow(), fmt)
  assert.equal(p.hand_id, 'r-1')
  assert.equal(p.round_number, 1042)
  assert.equal(p.winning_number, null)
  assert.equal(p.bonus_multiplier, 1)
  assert.equal(p.total_stake, 70)
  assert.equal(p.total_payout, 0)
  assert.equal(p.outcome, 'PENDING')
  assert.equal(p.is_settled, false)
  assert.equal(p.created_at, 'T:2026-10-25T06:30:00Z')
  assert.equal(p.created_at_iso, '2026-10-25T06:30:00Z')
  assert.equal(p.picks, '3: 50 · 7: 20')
  assert.equal(p.stakes.length, 10)
  assert.ok(p.stakes.every(s => !s.isWinner))
})

test('shapePlayerPlay: won and lost once settled', () => {
  const won = S.shapePlayerPlay(betRow({ is_settled: true, total_payout: '900' }, { winning_number: 3, bonus_multiplier: 2 }), fmt)
  assert.equal(won.outcome, 'WON')
  assert.equal(won.winning_number, 3)
  assert.equal(won.bonus_multiplier, 2)
  assert.equal(won.total_payout, 900)
  assert.equal(won.stakes[3].isWinner, true)
  assert.equal(won.stakes[3].amount, 50)

  const lost = S.shapePlayerPlay(betRow({ is_settled: true }, { winning_number: 0 }), fmt)
  assert.equal(lost.outcome, 'LOST')
  assert.equal(lost.stakes[0].isWinner, true)
  assert.equal(lost.stakes[0].amount, 0)
})

test('shapePlayerPlay: settled flag without a winning number stays PENDING', () => {
  const p = S.shapePlayerPlay(betRow({ is_settled: true, total_payout: 100 }), fmt)
  assert.equal(p.outcome, 'PENDING')
  assert.equal(p.is_settled, false)
})

test('shapePlayerPlay: round embedded as a one-item list', () => {
  const row = betRow({ is_settled: true }, { winning_number: 7 })
  ;(row as Record<string, unknown>).spin2win_rounds = [row.spin2win_rounds]
  const p = S.shapePlayerPlay(row, fmt)
  assert.equal(p.round_number, 1042)
  assert.equal(p.winning_number, 7)
  assert.equal(p.outcome, 'LOST')
})

test('playOutcome', () => {
  assert.equal(S.playOutcome(false, 500), 'PENDING')
  assert.equal(S.playOutcome(true, 1), 'WON')
  assert.equal(S.playOutcome(true, 0), 'LOST')
})

test('istDayKey uses Indian time', () => {
  assert.equal(S.istDayKey('2026-10-25T18:29:00Z'), '2026-10-25')
  assert.equal(S.istDayKey('2026-10-25T18:31:00Z'), '2026-10-26')
})

test('filterPlays: day and outcome, PENDING only under all', () => {
  const plays = [
    S.shapePlayerPlay(betRow({ round_id: 'a', is_settled: true, total_payout: 900 }, { winning_number: 3 }), fmt),
    S.shapePlayerPlay(betRow({ round_id: 'b', is_settled: true }, { winning_number: 1 }), fmt),
    S.shapePlayerPlay(betRow({ round_id: 'c', created_at: '2026-10-24T06:00:00Z' }), fmt),
  ]
  assert.deepEqual(S.filterPlays(plays, undefined, 'all').map(p => p.hand_id), ['a', 'b', 'c'])
  assert.deepEqual(S.filterPlays(plays, undefined, 'WON').map(p => p.hand_id), ['a'])
  assert.deepEqual(S.filterPlays(plays, undefined, 'LOST').map(p => p.hand_id), ['b'])
  assert.deepEqual(S.filterPlays(plays, '2026-10-24', 'all').map(p => p.hand_id), ['c'])
  assert.deepEqual(S.filterPlays(plays, '2026-10-24', 'LOST'), [])
})

test('summarizePlays: settled only, today vs lifetime', () => {
  const plays = [
    S.shapePlayerPlay(betRow({ is_settled: true, total_payout: 900 }, { winning_number: 3 }), fmt),
    S.shapePlayerPlay(betRow({ is_settled: true, total_stake: 100 }, { winning_number: 1 }), fmt),
    S.shapePlayerPlay(betRow({ total_stake: 5000 }), fmt),
    S.shapePlayerPlay(betRow({ is_settled: true, total_stake: 30, created_at: '2026-10-20T06:00:00Z' }, { winning_number: 0 }), fmt),
  ]
  const today = S.summarizePlays(plays, 'today', '2026-10-25')
  assert.deepEqual(today, { totalPlays: 2, totalBet: 170, totalWin: 900, netGgr: -730, marginPct: (-730 / 170) * 100 })
  const life = S.summarizePlays(plays, 'lifetime', '2026-10-25')
  assert.equal(life.totalPlays, 3)
  assert.equal(life.totalBet, 200)
  assert.equal(life.netGgr, -700)
  assert.deepEqual(S.summarizePlays([], 'lifetime', ''), { totalPlays: 0, totalBet: 0, totalWin: 0, netGgr: 0, marginPct: 0 })
})
