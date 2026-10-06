/**
 * Money totals -- pure rules for reading what the database function
 * staff_money_summary returns (migration 20261007010000_staff_money_totals.sql,
 * Issue #122). No imports, no database, no React: tested on its own
 * (money-totals-logic.test.ts, run with `node --test`).
 *
 * The database adds the bets up exactly, for Triple Chance and Lucky Card
 * separately; the dashboard shows the two combined and, as a small line, each
 * game's own share (user decision 2026-10-07, spec 17AY).
 */

/** One game's figures over one window: how many bets, the coins bet, the coins paid out. */
export interface GameMoney {
  bets: number
  stake: number
  payout: number
}

export interface MoneyByGame {
  triple_chance: GameMoney
  lucky_card: GameMoney
}

/** The three windows staff_money_summary answers in one call. */
export interface MoneySummary {
  lifetime: MoneyByGame
  today: MoneyByGame
  window: MoneyByGame
}

export const ZERO_GAME_MONEY: GameMoney = { bets: 0, stake: 0, payout: 0 }

export const EMPTY_MONEY_BY_GAME: MoneyByGame = {
  triple_chance: ZERO_GAME_MONEY,
  lucky_card: ZERO_GAME_MONEY,
}

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
  return { triple_chance: readGame(r.triple_chance), lucky_card: readGame(r.lucky_card) }
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

/** Both games added together. */
export function combineGames(m: MoneyByGame): GameMoney {
  return {
    bets: m.triple_chance.bets + m.lucky_card.bets,
    stake: m.triple_chance.stake + m.lucky_card.stake,
    payout: m.triple_chance.payout + m.lucky_card.payout,
  }
}

/** What the house kept: the coins bet minus the coins paid out (negative when players won more). */
export function houseResult(m: GameMoney): number {
  return m.stake - m.payout
}

/** The house result as a percentage of the coins bet; 0 when nothing was bet. */
export function marginPct(m: GameMoney): number {
  return m.stake > 0 ? (houseResult(m) / m.stake) * 100 : 0
}

/** One player's row from staff_player_money_rows (both games combined). */
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
// The small "Triple Chance X · Lucky Card Y" line under a combined figure
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
