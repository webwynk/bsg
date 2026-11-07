/**
 * Money totals -- pure rules for reading what the database function
 * staff_money_summary returns (migration 20261007010000_staff_money_totals.sql,
 * Issue #122). No imports, no database, no React: tested on its own
 * (money-totals-logic.test.ts, run with `node --test`).
 *
 * The database adds the bets up exactly, for Triple Chance, Lucky Card, Spin2Win
 * and Lucky 16 Card separately; the dashboard shows them combined and, as a small
 * line, each game's own share (user decision 2026-10-07, spec 17AY; Spin2Win added
 * 2026-10-25, Lucky 16 Card added 2026-10-30).
 */

// ---------------------------------------------------------------------------
// The game list (registry) -- the ONE place the dashboard lists its games
// ---------------------------------------------------------------------------

/**
 * Every game the dashboard reports on, in display order. `key` is the name the
 * database function staff_money_summary uses for that game's figures. Adding a
 * game = its bet table added to staff_money_summary (one migration) + one entry
 * here; the Gameplay & Bets Audit card then shows a tab for it by itself, and
 * the readers/totals below include it automatically. Lives in this pure file
 * (no imports) so the node --test tests can load it directly.
 */
export const GAMES = [
  { key: 'triple_chance', label: 'Triple Chance', dot: 'bg-violet-500' },
  { key: 'lucky_card', label: 'Lucky Card', dot: 'bg-rose-500' },
  { key: 'spin2win', label: 'Spin2Win', dot: 'bg-amber-500' },
  { key: 'lucky16', label: 'Lucky 16 Card', dot: 'bg-sky-500' },
] as const

/** A game's database key, e.g. 'lucky_card'. */
export type GameKey = (typeof GAMES)[number]['key']

/** One game's figures over one window: how many bets, the coins bet, the coins paid out. */
export interface GameMoney {
  bets: number
  stake: number
  payout: number
}

/** Each game's figures, one entry per game in GAMES. */
export type MoneyByGame = Record<GameKey, GameMoney>

/** The three windows staff_money_summary answers in one call. */
export interface MoneySummary {
  lifetime: MoneyByGame
  today: MoneyByGame
  window: MoneyByGame
}

export const ZERO_GAME_MONEY: GameMoney = { bets: 0, stake: 0, payout: 0 }

/** Builds a MoneyByGame with one entry per game in GAMES. */
function byGame(make: (key: GameKey) => GameMoney): MoneyByGame {
  return Object.fromEntries(GAMES.map(g => [g.key, make(g.key)])) as MoneyByGame
}

export const EMPTY_MONEY_BY_GAME: MoneyByGame = byGame(() => ZERO_GAME_MONEY)

export const EMPTY_MONEY_SUMMARY: MoneySummary = {
  lifetime: EMPTY_MONEY_BY_GAME,
  today: EMPTY_MONEY_BY_GAME,
  window: EMPTY_MONEY_BY_GAME,
}

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function readGame(raw: unknown): GameMoney {
  const r = (raw ?? {}) as Record<string, unknown>
  return { bets: num(r.bets), stake: num(r.stake), payout: num(r.payout) }
}

function readByGame(raw: unknown): MoneyByGame {
  const r = (raw ?? {}) as Record<string, unknown>
  // One entry per game in GAMES. An answer from before a game was added has no
  // part for it: it reads as 0. A part for a game not in GAMES is ignored.
  return byGame(key => readGame(r[key]))
}

/** Turns the database's JSON answer into numbers; anything missing becomes 0. */
export function readMoneySummary(raw: unknown): MoneySummary {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    lifetime: readByGame(r.lifetime),
    today: readByGame(r.today),
    window: readByGame(r.window),
  }
}

/** Every game in GAMES added together. */
export function combineGames(m: MoneyByGame): GameMoney {
  const total = { bets: 0, stake: 0, payout: 0 }
  for (const g of GAMES) {
    total.bets += m[g.key].bets
    total.stake += m[g.key].stake
    total.payout += m[g.key].payout
  }
  return total
}

/** What the house kept: the coins bet minus the coins paid out (negative when players won more). */
export function houseResult(m: GameMoney): number {
  return m.stake - m.payout
}

/** The house result as a percentage of the coins bet; 0 when nothing was bet. */
export function marginPct(m: GameMoney): number {
  return m.stake > 0 ? (houseResult(m) / m.stake) * 100 : 0
}

/** One player's row from staff_player_money_rows (all four games combined). */
export interface PlayerMoneyRow {
  user_id: string
  plays: number
  stake: number
  payout: number
  last_played_at: string | null
}

/** Turns the database's rows into numbers. */
export function readPlayerMoneyRows(raw: unknown): PlayerMoneyRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map(r => {
    const x = (r ?? {}) as Record<string, unknown>
    return {
      user_id: String(x.user_id ?? ''),
      plays: num(x.plays),
      stake: num(x.stake),
      payout: num(x.payout),
      last_played_at: x.last_played_at == null ? null : String(x.last_played_at),
    }
  })
}

// ---------------------------------------------------------------------------
// The small "Triple Chance · Lucky Card · Spin2Win · Lucky 16 Card" line under a combined figure
// ---------------------------------------------------------------------------

/** How a figure is written: a plain count, coins, coins with a sign (+ for zero or more), or a percentage. */
export type SplitKind = 'count' | 'money' | 'signed' | 'percent'

const coinFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

/** One game's figure as text, in the dashboard's usual Indian number grouping. */
export function formatSplitValue(value: number, kind: SplitKind): string {
  switch (kind) {
    case 'count': return String(value)
    case 'money': return coinFormat.format(value)
    case 'signed': return `${value >= 0 ? '+' : ''}${coinFormat.format(value)}`
    case 'percent': return `${value.toFixed(1)}%`
  }
}
