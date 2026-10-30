'use server'

import { createAdminClient } from '@/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth-guard'
import { asRpc } from '@/lib/rpc'
import {
  L16_BET_COLUMNS,
  bonusLabelLong,
  cardName,
  cardTotals,
  type CardStake,
} from '@/lib/lucky16'
import {
  boostRefusal,
  nextBonusRefusal,
  rtpRefusal,
  serverSecondsInto,
  shapeDraw,
  shapePlayerBet,
  type Lucky16BetRow,
  type Lucky16Draw,
  type Lucky16PlayerBet,
  type Lucky16RoundRow,
} from './lucky16-live-logic'

/**
 * Lucky 16 Card -- server actions for the Live Game "Lucky 16 Card" tab
 * (lucky16-live.tsx). Superadmin only. Its own file so nothing of the other
 * games' actions is touched; every table and function used here belongs to
 * Lucky 16 Card (lucky16_rounds, lucky16_bets, lucky16_config,
 * lucky16_get_current_round, lucky16_apply_bonus_to_current_round).
 *
 * UNTYPED CLIENT, on purpose, as for the other games: the generated
 * src/lib/database.types.ts has no lucky16_* object, so a client typed against
 * it would not compile for these tables. The columns and functions used below
 * were checked against the live schema. If database.types.ts is regenerated one
 * day, the cast can simply be dropped.
 *
 * Each action calls requireAuth() exactly once (RULE #20) and writes its audit
 * line straight through the admin client with the already-verified user id,
 * instead of calling logAuditEventAction (which would verify the caller a
 * second time).
 */

function l16Db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient
}

/** Same contract as the Triple Chance audit line: it must never break the
 *  operation it records, so a failure to write it is swallowed. */
async function writeAuditLine(db: SupabaseClient, actorId: string, detail: string): Promise<void> {
  try {
    await db.from('audit_log').insert({ actor_id: actorId, kind: 'system', detail })
  } catch {
    // Audit logging must never break the operation it is recording.
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}

/** The columns of a finished round that the ledger and the recent-draw strip show. */
const DRAW_COLUMNS =
  'id, round_number, winning_rank, winning_suit, total_stake, total_payout, ' +
  'bonus_multiplier, rtp_percentage, scheduled_at, drawn_at, lucky16_bets(count)'

/** How many bets of the running round one load adds up. If a round ever has
 *  more, the tab says the card totals are partial (stakesPartial). */
const LIVE_STAKE_ROW_LIMIT = 5000

// ---------------------------------------------------------------------------
// The tab's one load (RULE #20: one action per page-load / 3-second refresh)
// ---------------------------------------------------------------------------

export interface Lucky16ActiveRound {
  roundId: string
  roundNumber: number
  phase: string
  /** The server's second of the round at the moment of this reading (0 to 102). */
  secondsInto: number
  drawAtSecond: number
  /** True once the card is drawn. */
  drawn: boolean
  /** "K♠" once drawn, else null. */
  card: string | null
  /** This round's own pinned bonus (1 to 10), read straight from the table: the
   *  player-facing function hides it until the draw, the admin screen need not. */
  bonus: number
  /** Bets placed on this round so far. */
  playerCount: number
  /** The round's own total, written by the draw (0 until then). */
  totalStake: number
  /** The coins on the board now, added up from the bets. */
  liveStake: number
  /** All sixteen cards with the coins on each, added up from the bets. */
  cards: CardStake[]
  /** True when the round has more bets than one load adds up, so the live
   *  figures are too low. */
  stakesPartial: boolean
}

export interface Lucky16LiveData {
  /** The RTP the NEXT round will be created with (lucky16_config). */
  rtp: number | null
  /** The bonus queued for the next round (lucky16_config); resets to 1 once used. */
  nextBonus: number | null
  /** The 20 latest drawn rounds, newest first. */
  draws: Lucky16Draw[]
  activeRound: Lucky16ActiveRound | null
  error: string | null
}

const EMPTY_LIVE: Lucky16LiveData = {
  rtp: null, nextBonus: null, draws: [], activeRound: null, error: null,
}

interface Lucky16CurrentRound {
  round_id: string
  round_number: number
  phase: string
  seconds_remaining: number
  seconds_into: number
  draw_at_second: number
}

/**
 * Everything the tab shows, in one call: the settings, the 20 latest draws and
 * the round in progress. Reading the round in progress goes through
 * lucky16_get_current_round() (the same call every player's phone makes,
 * which also creates the round if nobody has yet and draws/settles it from the
 * draw second on -- exactly what the other games' tabs do with their own), then
 * reads that round's row for what the function hides until the draw, and its
 * bets for the coins on each card.
 */
export async function getLucky16LiveAction(): Promise<Lucky16LiveData> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { ...EMPTY_LIVE, error: auth.error }

  try {
    const db = l16Db()

    const readCurrentRound = async (): Promise<Lucky16ActiveRound | null> => {
      const { data: raw, error } = await db.rpc('lucky16_get_current_round')
      if (error) throw new Error(`current round: ${error.message}`)
      const cur = asRpc<Lucky16CurrentRound | null>(raw)
      if (!cur) return null

      const [rowRes, betsRes] = await Promise.all([
        db.from('lucky16_rounds')
          .select('bonus_multiplier, winning_rank, winning_suit, total_stake')
          .eq('id', cur.round_id)
          .single(),
        db.from('lucky16_bets')
          .select(`total_stake, ${L16_BET_COLUMNS.join(', ')}`, { count: 'exact' })
          .eq('round_id', cur.round_id)
          .limit(LIVE_STAKE_ROW_LIMIT),
      ])
      if (rowRes.error) throw new Error(`current round row: ${rowRes.error.message}`)
      if (betsRes.error) throw new Error(`current round bets: ${betsRes.error.message}`)
      const row = rowRes.data
      const bets = (betsRes.data ?? []) as unknown as Array<Record<string, unknown>>
      const cards = cardTotals(bets, row.winning_rank, row.winning_suit)
      const playerCount = betsRes.count ?? bets.length

      const card = cardName(row.winning_rank, row.winning_suit)
      return {
        roundId: cur.round_id,
        roundNumber: Number(cur.round_number),
        phase: cur.phase,
        secondsInto: Number(cur.seconds_into),
        drawAtSecond: Number(cur.draw_at_second),
        drawn: card !== null,
        card,
        bonus: Number(row.bonus_multiplier ?? 1),
        playerCount,
        totalStake: Number(row.total_stake ?? 0),
        liveStake: cards.reduce((sum, c) => sum + c.amount, 0),
        cards,
        stakesPartial: playerCount > bets.length,
      }
    }

    const [configRes, drawsRes, activeRound] = await Promise.all([
      db.from('lucky16_config').select('rtp_percentage, bonus_multiplier').eq('id', 'global').single(),
      db.from('lucky16_rounds')
        .select(DRAW_COLUMNS)
        .not('winning_rank', 'is', null)
        .order('round_number', { ascending: false })
        .limit(20),
      readCurrentRound(),
    ])
    if (configRes.error) throw new Error(`settings: ${configRes.error.message}`)
    if (drawsRes.error) throw new Error(`draws: ${drawsRes.error.message}`)

    const rows = (drawsRes.data ?? []) as unknown as Lucky16RoundRow[]
    return {
      rtp: Number(configRes.data.rtp_percentage),
      nextBonus: Number(configRes.data.bonus_multiplier),
      draws: rows.map(shapeDraw),
      activeRound,
      error: null,
    }
  } catch (err) {
    return { ...EMPTY_LIVE, error: `Could not load Lucky 16 Card: ${errorText(err)}` }
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Sets the RTP the next rounds are created with. A round already running keeps
 *  the RTP it was created with (each round pins its own copy). */
export async function updateLucky16RtpAction(rtpPercentage: number): Promise<{
  success: boolean
  rtp: number | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { success: false, rtp: null, error: auth.error ?? 'Unauthorized' }

  // The database enforces the range too (CHECK on lucky16_config); the lock is
  // checked here so a stale screen cannot slip a change in after the cut-off.
  const refusal = rtpRefusal(rtpPercentage, serverSecondsInto(Date.now()))
  if (refusal) return { success: false, rtp: null, error: refusal }

  try {
    const db = l16Db()
    const { data, error } = await db
      .from('lucky16_config')
      .update({ rtp_percentage: rtpPercentage, updated_at: new Date().toISOString() })
      .eq('id', 'global')
      .select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length !== 1) throw new Error('the settings row was not found')

    await writeAuditLine(db, auth.user.id, `Lucky 16 Card RTP target set to ${rtpPercentage}% — takes effect next round`)
    revalidatePath('/superadmin/live-game')
    return { success: true, rtp: rtpPercentage, error: null }
  } catch (err) {
    return { success: false, rtp: null, error: `Could not update Lucky 16 Card RTP: ${errorText(err)}` }
  }
}

/** Sets the bonus (1 = N, 2 to 10) queued for the NEXT round. It returns to 1
 *  by itself once a round has been created with it. */
export async function updateLucky16NextBonusAction(bonus: number): Promise<{
  success: boolean
  bonus: number | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { success: false, bonus: null, error: auth.error ?? 'Unauthorized' }

  const refusal = nextBonusRefusal(bonus, serverSecondsInto(Date.now()))
  if (refusal) return { success: false, bonus: null, error: refusal }

  try {
    const db = l16Db()
    const { data, error } = await db
      .from('lucky16_config')
      .update({ bonus_multiplier: bonus, updated_at: new Date().toISOString() })
      .eq('id', 'global')
      .select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length !== 1) throw new Error('the settings row was not found')

    await writeAuditLine(db, auth.user.id, `Lucky 16 Card bonus multiplier set to ${bonusLabelLong(bonus)} — takes effect next round`)
    revalidatePath('/superadmin/live-game')
    return { success: true, bonus, error: null }
  } catch (err) {
    return { success: false, bonus: null, error: `Could not update Lucky 16 Card bonus: ${errorText(err)}` }
  }
}

/**
 * Boosts the round ALREADY IN PROGRESS (1 to 10), refused from the boost lock
 * second on. Never writes lucky16_config: the database function finds the
 * current round itself, writes only that round's own bonus, and refuses once the
 * round is drawn.
 */
export async function applyLucky16BonusToCurrentRoundAction(bonus: number): Promise<{
  success: boolean
  roundNumber: number | null
  bonus: number | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) {
    return { success: false, roundNumber: null, bonus: null, error: auth.error ?? 'Unauthorized' }
  }

  const refusal = boostRefusal(bonus, serverSecondsInto(Date.now()))
  if (refusal) return { success: false, roundNumber: null, bonus: null, error: refusal }

  try {
    const db = l16Db()
    const { data: raw, error } = await db.rpc('lucky16_apply_bonus_to_current_round', { p_bonus: bonus })
    if (error) throw new Error(error.message)
    const result = asRpc<{ success: boolean; round_number?: number; bonus_multiplier?: number; error?: string }>(raw)

    if (!result.success) {
      const messages: Record<string, string> = {
        already_drawn: 'Too late — this round has already been drawn. Try again next round.',
        round_not_found: 'No active round found right now.',
        invalid_bonus: 'Bonus multiplier must be a whole number from 1 (N) to 10.',
      }
      return {
        success: false, roundNumber: result.round_number ?? null, bonus: null,
        error: messages[result.error ?? ''] ?? `Could not apply bonus: ${result.error}`,
      }
    }

    await writeAuditLine(
      db, auth.user.id,
      `Lucky 16 Card bonus multiplier set to ${bonusLabelLong(bonus)} for the CURRENT round (#${result.round_number}) — takes effect immediately`
    )
    revalidatePath('/superadmin/live-game')
    return { success: true, roundNumber: result.round_number ?? null, bonus: result.bonus_multiplier ?? null, error: null }
  } catch (err) {
    return { success: false, roundNumber: null, bonus: null, error: `Could not apply bonus: ${errorText(err)}` }
  }
}

// ---------------------------------------------------------------------------
// The players of one round (loaded when a ledger row is opened)
// ---------------------------------------------------------------------------

/** A round may have thousands of bets; the ledger shows the biggest stakes
 *  first and says how many more there are. */
const PLAYER_LIMIT = 500

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Lucky16PlayersResult {
  players: Lucky16PlayerBet[]
  /** How many bets the round has in all (may be more than players.length). */
  total: number
  error: string | null
}

export async function getLucky16RoundPlayersAction(roundId: string): Promise<Lucky16PlayersResult> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { players: [], total: 0, error: auth.error }

  if (typeof roundId !== 'string' || !UUID_PATTERN.test(roundId)) {
    return { players: [], total: 0, error: 'Invalid round.' }
  }

  try {
    const db = l16Db()
    const [roundRes, betsRes] = await Promise.all([
      db.from('lucky16_rounds').select('winning_rank, winning_suit').eq('id', roundId).single(),
      db.from('lucky16_bets')
        .select(`user_id, total_stake, total_payout, ${L16_BET_COLUMNS.join(', ')}, profiles:user_id ( username )`,
          { count: 'exact' })
        .eq('round_id', roundId)
        .order('total_stake', { ascending: false })
        .limit(PLAYER_LIMIT),
    ])
    if (roundRes.error) throw new Error(`round: ${roundRes.error.message}`)
    if (betsRes.error) throw new Error(`bets: ${betsRes.error.message}`)

    const rows = (betsRes.data ?? []) as unknown as Lucky16BetRow[]
    return {
      players: rows.map(r => shapePlayerBet(r, roundRes.data.winning_rank, roundRes.data.winning_suit)),
      total: betsRes.count ?? rows.length,
      error: null,
    }
  } catch (err) {
    return { players: [], total: 0, error: `Could not load players: ${errorText(err)}` }
  }
}
