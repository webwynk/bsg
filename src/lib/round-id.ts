/**
 * How a round is written everywhere: TC-17413022. The round number comes from
 * the clock, so games on the same clock share it; the prefix tells them apart.
 * This is display only: the database stores the number.
 */
export type RoundGame = 'TC' | 'LC' | 'SW' | 'LS'

export function roundId(game: RoundGame, roundNumber: number): string {
  return `${game}-${roundNumber}`
}

/**
 * Whether a search box's text finds this round, with or without the game's
 * prefix, inside that game's own list. An empty search finds nothing here, so a
 * caller keeps its own "no search" handling.
 */
export function roundMatches(game: RoundGame, roundNumber: number, query: string): boolean {
  const text = query.trim().toUpperCase()
  if (!text) return false
  return roundId(game, roundNumber).includes(text)
}
