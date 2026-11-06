/**
 * Printed tickets in player history. The rules that can be tested on their own:
 * no database or session here, so the access check is exercised with fakes.
 */

export type TicketGame = 'TC' | 'SW' | 'LC' | 'LS'

/** The most rounds one read may ask for; the screens show far fewer. */
const MAX_ROUNDS = 100

/** One ticket as print_staff_tickets returns it, without what the screen does not show. */
export interface PlayerTicket {
  ticket_code: string
  ticket_no: number
  round_number: number
  total_stake: number
  is_drawn: boolean
  win: number
  /** What was bet: LS and LC { k_hearts: 10 }, SW { n3: 10 }, TC { single, double, triple }. */
  items: Record<string, unknown>
}

export type TicketSuit = 'hearts' | 'spades' | 'diamonds' | 'clubs'

/** One piece of a ticket's contents: a card or number with its coins, or a Triple Chance board. */
export type TicketToken =
  | { kind: 'card'; rank: string; suit: TicketSuit; amount: number }
  | { kind: 'number'; number: number; amount: number }
  | { kind: 'board'; title: string; text: string }

const SUIT_ORDER: TicketSuit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const SUIT_SYMBOL: Record<TicketSuit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }
const RANK_ORDER = ['A', 'J', 'Q', 'K']
const TC_BOARDS = [['single', 'SINGLE', 1], ['double', 'DOUBLE', 2], ['triple', 'TRIPLE', 3]] as const

/** One Triple Chance board in the printed ticket's form: 2, 6, 7 (5) | 4, 9 (500). */
function boardText(board: Record<string, unknown>, pad: number, format: (amount: number) => string): string {
  const groups = new Map<number, string[]>()
  for (const [key, value] of Object.entries(board)) {
    const amount = Number(value)
    if (amount > 0) groups.set(amount, [...(groups.get(amount) ?? []), key.padStart(pad, '0')])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([amount, keys]) => `${keys.sort().join(', ')} (${format(amount)})`)
    .join(' | ')
}

/**
 * A ticket's contents, in the printed ticket's order: smallest amount first, then
 * spades, hearts, diamonds, clubs, then rank. Keys it does not know are left out.
 */
export function ticketTokens(game: TicketGame, items: Record<string, unknown>, format: (amount: number) => string): TicketToken[] {
  if (game === 'TC') {
    return TC_BOARDS.flatMap(([key, title, pad]) => {
      const text = boardText((items[key] ?? {}) as Record<string, unknown>, pad, format)
      return text ? [{ kind: 'board' as const, title, text }] : []
    })
  }
  if (game === 'SW') {
    return Object.entries(items).flatMap(([key, value]) => {
      const match = /^n(\d)$/.exec(key)
      return match && Number(value) > 0 ? [{ kind: 'number' as const, number: Number(match[1]), amount: Number(value) }] : []
    }).sort((a, b) => a.amount - b.amount || a.number - b.number)
  }
  return Object.entries(items).flatMap(([key, value]) => {
    const match = /^([a-z])_(hearts|spades|diamonds|clubs)$/.exec(key)
    if (!match || !(Number(value) > 0)) return []
    return [{ kind: 'card' as const, rank: match[1].toUpperCase(), suit: match[2] as TicketSuit, amount: Number(value) }]
  }).sort((a, b) => a.amount - b.amount
    || SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit)
    || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank))
}

/** The contents as text, for the popup. */
export function ticketSummary(game: TicketGame, items: Record<string, unknown>, format: (amount: number) => string): string {
  return ticketTokens(game, items, format).map(token => {
    if (token.kind === 'board') return `${token.title}: ${token.text}`
    if (token.kind === 'card') return `${token.rank}${SUIT_SYMBOL[token.suit]} ${format(token.amount)}`
    return `${token.number}: ${format(token.amount)}`
  }).join(summarySeparator(game))
}

function summarySeparator(game: TicketGame): string {
  return game === 'TC' ? '\n' : ' · '
}

export type TicketsByRound = Record<number, PlayerTicket[]>

export function groupTicketsByRound(tickets: PlayerTicket[]): TicketsByRound {
  const rounds: TicketsByRound = {}
  for (const ticket of tickets) (rounds[ticket.round_number] ??= []).push(ticket)
  return rounds
}

/** What loadPlayerTickets needs from outside, passed in by the server action. */
export interface PlayerTicketDeps {
  resolvePlayerId: (identifier: string) => Promise<string | null>
  assertOwnership: (
    caller: { id: string; role: string },
    playerId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  readTickets: (playerId: string, game: TicketGame, rounds: number[]) => Promise<PlayerTicket[]>
}

/**
 * Reads one player's tickets for the given rounds. The ownership check always
 * runs before the read, because readTickets uses the service key, which row
 * rules do not limit: an agent asking for another agent's player gets the
 * refusal and no tickets.
 */
export async function loadPlayerTickets(
  caller: { id: string; role: string },
  playerIdentifier: string,
  game: TicketGame,
  rounds: number[],
  deps: PlayerTicketDeps,
): Promise<{ tickets: TicketsByRound; error: string | null }> {
  if (!['TC', 'SW', 'LC', 'LS'].includes(game)) return { tickets: {}, error: 'Unknown game.' }
  const wanted = [...new Set(rounds.filter(Number.isSafeInteger))].slice(0, MAX_ROUNDS)
  if (wanted.length === 0) return { tickets: {}, error: null }

  try {
    const playerId = await deps.resolvePlayerId(playerIdentifier)
    if (!playerId) return { tickets: {}, error: 'Player not found.' }

    const owned = await deps.assertOwnership(caller, playerId)
    if (!owned.ok) return { tickets: {}, error: owned.error }

    return { tickets: groupTicketsByRound(await deps.readTickets(playerId, game, wanted)), error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { tickets: {}, error: `Could not load tickets: ${message}` }
  }
}
