'use server'

import { createAdminClient } from '@/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth-guard'
import { asRpc } from '@/lib/rpc'
import {
  LC_BET_COLUMNS,
  bonusLabelLong,
  cardName,
  embeddedCount,
  isValidBonus,
} from '@/lib/lucky-card'
import {
  isValidRtp,
  shapeDraw,
  shapePlayerBet,
  type LuckyCardBetRow,
  type LuckyCardDraw,
  type LuckyCardPlayerBet,
  type LuckyCardRoundRow,
} from './lucky-card-live-logic'

/**
 * Lucky Card -- server actions for the Live Game "Lucky Card" tab
 * (lucky-card-live.tsx). Superadmin only. Its own file so nothing of Triple
 * Chance's actions (../actions.ts) is touched; every table and function used
 * here belongs to Lucky Card (lucky_card_rounds, lucky_card_bets,
 * lucky_card_config, lucky_card_get_current_round,
 * lucky_card_apply_bonus_to_current_round).
 *
 * UNTYPED CLIENT, on purpose (decided 2026-10-06, spec 17AO): the generated
 * src/lib/database.types.ts has no lucky_card_* object yet, so a client typed
 * against it would not compile for these tables. The compile-time column check
 * is replaced by a real-database test of every query below (run against the
 * live schema before this file was accepted). If database.types.ts is
 * regenerated one day, the cast can simply be dropped.
 *
 * Each action calls requireAuth() exactly once (RULE #20) and writes its audit
 * line straight through the admin client with the already-verified user id,
 * instead of calling logAuditEventAction (which would verify the caller a
 * second time).
 */

function lcDb(): SupabaseClient {
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
  'bonus_multiplier, rtp_percentage, scheduled_at, drawn_at, lucky_card_bets(count)'

// ---------------------------------------------------------------------------
// The tab's one load (RULE #20: one action per page-load / 3-second refresh)
// ---------------------------------------------------------------------------

export interface LuckyCardActiveRound {
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
}

export interface LuckyCardLiveData {
  /** The RTP the NEXT round will be created with (lucky_card_config). */
  rtp: number | null
  /** The bonus queued for the next round (lucky_card_config); resets to 1 once used. */
  nextBonus: number | null
  /** The 20 latest drawn rounds, newest first. */
  draws: LuckyCardDraw[]
  activeRound: LuckyCardActiveRound | null
  error: string | null
}

const EMPTY_LIVE: LuckyCardLiveData = {
  rtp: null, nextBonus: null, draws: [], activeRound: null, error: null,
}

interface LuckyCardCurrentRound {
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
 * lucky_card_get_current_round() (the same call every player's phone makes,
 * which also creates the round if nobody has yet and draws/settles it from the
 * draw second on -- exactly what Triple Chance's tab does with its own), then
 * reads that round's row for what the function hides until the draw.
 */
export async function getLuckyCardLiveAction(): Promise<LuckyCardLiveData> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { ...EMPTY_LIVE, error: auth.error }

  try {
    const db = lcDb()

    const readCurrentRound = async (): Promise<LuckyCardActiveRound | null> => {
      const { data: raw, error } = await db.rpc('lucky_card_get_current_round')
      if (error) throw new Error(`current round: ${error.message}`)
      const cur = asRpc<LuckyCardCurrentRound | null>(raw)
      if (!cur) return null

      const { data: row, error: rowError } = await db
        .from('lucky_card_rounds')
        .select('bonus_multiplier, winning_rank, winning_suit, lucky_card_bets(count)')
        .eq('id', cur.round_id)
        .single()
      if (rowError) throw new Error(`current round row: ${rowError.message}`)

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
        playerCount: embeddedCount(row.lucky_card_bets),
      }
    }

    const [configRes, drawsRes, activeRound] = await Promise.all([
      db.from('lucky_card_config').select('rtp_percentage, bonus_multiplier').eq('id', 'global').single(),
      db.from('lucky_card_rounds')
        .select(DRAW_COLUMNS)
        .not('winning_rank', 'is', null)
        .order('round_number', { ascending: false })
        .limit(20),
      readCurrentRound(),
    ])
    if (configRes.error) throw new Error(`settings: ${configRes.error.message}`)
    if (drawsRes.error) throw new Error(`draws: ${drawsRes.error.message}`)

    const rows = (drawsRes.data ?? []) as unknown as LuckyCardRoundRow[]
    return {
      rtp: Number(configRes.data.rtp_percentage),
      nextBonus: Number(configRes.data.bonus_multiplier),
      draws: rows.map(shapeDraw),
      activeRound,
      error: null,
    }
  } catch (err) {
    return { ...EMPTY_LIVE, error: `Could not load Lucky Card: ${errorText(err)}` }
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Sets the RTP the next rounds are created with. A round already running keeps
 *  the RTP it was created with (each round pins its own copy). */
export async function updateLuckyCardRtpAction(rtpPercentage: number): Promise<{
  success: boolean
  rtp: number | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { success: false, rtp: null, error: auth.error ?? 'Unauthorized' }

  // The database enforces this range too (CHECK on lucky_card_config); validating
  // here just produces a friendlier message.
  if (!isValidRtp(rtpPercentage)) {
    return { success: false, rtp: null, error: 'RTP must be a number between 30 and 100.' }
  }

  try {
    const db = lcDb()
    const { data, error } = await db
      .from('lucky_card_config')
      .update({ rtp_percentage: rtpPercentage, updated_at: new Date().toISOString() })
      .eq('id', 'global')
      .select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length !== 1) throw new Error('the settings row was not found')

    await writeAuditLine(db, auth.user.id, `Lucky Card RTP target set to ${rtpPercentage}% — takes effect next round`)
    revalidatePath('/superadmin/live-game')
    return { success: true, rtp: rtpPercentage, error: null }
  } catch (err) {
    return { success: false, rtp: null, error: `Could not update Lucky Card RTP: ${errorText(err)}` }
  }
}

/** Sets the bonus (1 = N, 2 to 10) queued for the NEXT round. It returns to 1
 *  by itself once a round has been created with it. */
export async function updateLuckyCardNextBonusAction(bonus: number): Promise<{
  success: boolean
  bonus: number | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { success: false, bonus: null, error: auth.error ?? 'Unauthorized' }

  if (!isValidBonus(bonus)) {
    return { success: false, bonus: null, error: 'Bonus multiplier must be a whole number from 1 (N) to 10.' }
  }

  try {
    const db = lcDb()
    const { data, error } = await db
      .from('lucky_card_config')
      .update({ bonus_multiplier: bonus, updated_at: new Date().toISOString() })
      .eq('id', 'global')
      .select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length !== 1) throw new Error('the settings row was not found')

    await writeAuditLine(db, auth.user.id, `Lucky Card bonus multiplier set to ${bonusLabelLong(bonus)} — takes effect next round`)
    revalidatePath('/superadmin/live-game')
    return { success: true, bonus, error: null }
  } catch (err) {
    return { success: false, bonus: null, error: `Could not update Lucky Card bonus: ${errorText(err)}` }
  }
}

/**
 * Boosts the round ALREADY IN PROGRESS (1 to 10). Never writes
 * lucky_card_config: the database function finds the current round itself,
 * writes only that round's own bonus, and refuses once the round is drawn.
 */
export async function applyLuckyCardBonusToCurrentRoundAction(bonus: number): Promise<{
  success: boolean
  roundNumber: number | null
  bonus: number | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) {
    return { success: false, roundNumber: null, bonus: null, error: auth.error ?? 'Unauthorized' }
  }

  if (!isValidBonus(bonus)) {
    return { success: false, roundNumber: null, bonus: null, error: 'Bonus multiplier must be a whole number from 1 (N) to 10.' }
  }

  try {
    const db = lcDb()
    const { data: raw, error } = await db.rpc('lucky_card_apply_bonus_to_current_round', { p_bonus: bonus })
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
      `Lucky Card bonus multiplier set to ${bonusLabelLong(bonus)} for the CURRENT round (#${result.round_number}) — takes effect immediately`
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

export interface LuckyCardPlayersResult {
  players: LuckyCardPlayerBet[]
  /** How many bets the round has in all (may be more than players.length). */
  total: number
  error: string | null
}

export async function getLuckyCardRoundPlayersAction(roundId: string): Promise<LuckyCardPlayersResult> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { players: [], total: 0, error: auth.error }

  if (typeof roundId !== 'string' || !UUID_PATTERN.test(roundId)) {
    return { players: [], total: 0, error: 'Invalid round.' }
  }

  try {
    const db = lcDb()
    const [roundRes, betsRes] = await Promise.all([
      db.from('lucky_card_rounds').select('winning_rank, winning_suit').eq('id', roundId).single(),
      db.from('lucky_card_bets')
        .select(`user_id, total_stake, total_payout, ${LC_BET_COLUMNS.join(', ')}, profiles:user_id ( username )`,
          { count: 'exact' })
        .eq('round_id', roundId)
        .order('total_stake', { ascending: false })
        .limit(PLAYER_LIMIT),
    ])
    if (roundRes.error) throw new Error(`round: ${roundRes.error.message}`)
    if (betsRes.error) throw new Error(`bets: ${betsRes.error.message}`)

    const rows = (betsRes.data ?? []) as unknown as LuckyCardBetRow[]
    return {
      players: rows.map(r => shapePlayerBet(r, roundRes.data.winning_rank, roundRes.data.winning_suit)),
      total: betsRes.count ?? rows.length,
      error: null,
    }
  } catch (err) {
    return { players: [], total: 0, error: `Could not load players: ${errorText(err)}` }
  }
}
