'use server'

import { createAdminClient } from '@/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth-guard'
import { asRpc } from '@/lib/rpc'
import {
  S2W_BET_COLUMNS,
  asWinningNumber,
  bonusLabelLong,
  embeddedCount,
  isValidBonus,
} from '@/lib/spin2win'
import {
  S2W_BOOST_LOCK_SECOND,
  S2W_CONFIG_LOCK_SECOND,
  isValidRtp,
  serverSecondsInto,
  shapeDraw,
  shapePlayerBet,
  sumBetStakes,
  type Spin2WinBetRow,
  type Spin2WinDraw,
  type Spin2WinPlayerBet,
  type Spin2WinRoundRow,
} from './spin2win-live-logic'

/**
 * Spin2Win -- server actions for the Live Game "Spin2Win" tab
 * (spin2win-live.tsx). Superadmin only. Its own file so nothing of Triple
 * Chance's actions (../actions.ts) or Lucky Card's (lucky-card-actions.ts) is
 * touched; every table and function used here belongs to Spin2Win
 * (spin2win_rounds, spin2win_bets, spin2win_config, spin2win_get_current_round,
 * spin2win_apply_bonus_to_current_round).
 *
 * UNTYPED CLIENT, on purpose (same decision as Lucky Card's, spec 17AO): the
 * generated src/lib/database.types.ts has no spin2win_* object, so a client
 * typed against it would not compile for these tables. If database.types.ts is
 * regenerated one day, the cast can simply be dropped.
 *
 * Each action calls requireAuth() exactly once (RULE #20) and writes its audit
 * line straight through the admin client with the already-verified user id,
 * instead of calling logAuditEventAction (which would verify the caller a
 * second time).
 *
 * The three write actions also refuse late in the round (RTP and next-round
 * bonus from second 88, the boost from second 85), matching the locks the tab
 * shows, so a stale screen cannot slip a change in. The second is read from
 * this server's clock (epoch % 100, the database's own formula); the database
 * still has the final word on the boost (it refuses once the round is drawn).
 */

function s2wDb(): SupabaseClient {
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

const CONFIG_LOCKED_MESSAGE =
  'Locked — betting has closed for this round. Try again when the next round starts.'

/** The columns of a finished round that the ledger and the recent-draw strip show. */
const DRAW_COLUMNS =
  'id, round_number, winning_number, total_stake, total_payout, ' +
  'bonus_multiplier, rtp_percentage, scheduled_at, drawn_at, spin2win_bets(count)'

// ---------------------------------------------------------------------------
// The tab's one load (RULE #20: one action per page-load / 3-second refresh)
// ---------------------------------------------------------------------------

export interface Spin2WinActiveRound {
  roundId: string
  roundNumber: number
  phase: string
  /** The server's second of the round at the moment of this reading (0 to 99). */
  secondsInto: number
  drawAtSecond: number
  /** True once the number is drawn. */
  drawn: boolean
  /** 0 to 9 once drawn, else null. */
  winningNumber: number | null
  /** This round's own pinned bonus (1 to 4), read straight from the table: the
   *  player-facing function hides it until the draw, the admin screen need not. */
  bonus: number
  /** Bets placed on this round so far. */
  playerCount: number
  /** The round's own total stake (filled in by the draw; 0 before it). */
  totalStake: number
  /** The round's bets' total_stake added up at this reading (live during betting). */
  liveStake: number
}

export interface Spin2WinLiveData {
  /** The RTP the NEXT round will be created with (spin2win_config). */
  rtp: number | null
  /** The bonus queued for the next round (spin2win_config); resets to 1 once used. */
  nextBonus: number | null
  /** The 20 latest drawn rounds, newest first. */
  draws: Spin2WinDraw[]
  activeRound: Spin2WinActiveRound | null
  error: string | null
}

/** Cap on the bet rows read to add up the live stake (one row per player bet;
 *  far above any expected round, and keeps the read bounded). */
const LIVE_STAKE_ROW_LIMIT = 10000

const EMPTY_LIVE: Spin2WinLiveData = {
  rtp: null, nextBonus: null, draws: [], activeRound: null, error: null,
}

interface Spin2WinCurrentRound {
  round_id: string
  round_number: number
  phase: string
  seconds_remaining: number
  seconds_into: number
  draw_at_second: number
  winning_number: number | null
  bonus_multiplier: number | null
}

/**
 * Everything the tab shows, in one call: the settings, the 20 latest draws and
 * the round in progress. Reading the round in progress goes through
 * spin2win_get_current_round() (the same call every player's phone makes,
 * which also creates the round if nobody has yet and draws/settles it from the
 * draw second on -- exactly what the Lucky Card tab does with its own), then
 * reads that round's row for what the function hides until the draw.
 */
export async function getSpin2WinLiveAction(): Promise<Spin2WinLiveData> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { ...EMPTY_LIVE, error: auth.error }

  try {
    const db = s2wDb()

    const readCurrentRound = async (): Promise<Spin2WinActiveRound | null> => {
      const { data: raw, error } = await db.rpc('spin2win_get_current_round')
      if (error) throw new Error(`current round: ${error.message}`)
      const cur = asRpc<Spin2WinCurrentRound | null>(raw)
      if (!cur) return null

      // The round's row, and its bets' stakes added up live (the row's own
      // total_stake is only written by the draw). One extra lookup per load.
      const [rowRes, stakesRes] = await Promise.all([
        db.from('spin2win_rounds')
          .select('bonus_multiplier, winning_number, total_stake, spin2win_bets(count)')
          .eq('id', cur.round_id)
          .single(),
        db.from('spin2win_bets')
          .select('total_stake')
          .eq('round_id', cur.round_id)
          .limit(LIVE_STAKE_ROW_LIMIT),
      ])
      if (rowRes.error) throw new Error(`current round row: ${rowRes.error.message}`)
      if (stakesRes.error) throw new Error(`current round stakes: ${stakesRes.error.message}`)
      const row = rowRes.data

      const winningNumber = asWinningNumber(row.winning_number)
      return {
        roundId: cur.round_id,
        roundNumber: Number(cur.round_number),
        phase: cur.phase,
        secondsInto: Number(cur.seconds_into),
        drawAtSecond: Number(cur.draw_at_second),
        drawn: winningNumber !== null,
        winningNumber,
        bonus: Number(row.bonus_multiplier ?? 1),
        playerCount: embeddedCount(row.spin2win_bets),
        totalStake: Number(row.total_stake ?? 0),
        liveStake: sumBetStakes(stakesRes.data as Array<{ total_stake: number | string | null }> | null),
      }
    }

    const [configRes, drawsRes, activeRound] = await Promise.all([
      db.from('spin2win_config').select('rtp_percentage, bonus_multiplier').eq('id', 'global').single(),
      db.from('spin2win_rounds')
        .select(DRAW_COLUMNS)
        .not('winning_number', 'is', null)
        .order('round_number', { ascending: false })
        .limit(20),
      readCurrentRound(),
    ])
    if (configRes.error) throw new Error(`settings: ${configRes.error.message}`)
    if (drawsRes.error) throw new Error(`draws: ${drawsRes.error.message}`)

    const rows = (drawsRes.data ?? []) as unknown as Spin2WinRoundRow[]
    return {
      rtp: Number(configRes.data.rtp_percentage),
      nextBonus: Number(configRes.data.bonus_multiplier),
      draws: rows.map(shapeDraw),
      activeRound,
      error: null,
    }
  } catch (err) {
    return { ...EMPTY_LIVE, error: `Could not load Spin2Win: ${errorText(err)}` }
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Sets the RTP the next rounds are created with. A round already running keeps
 *  the RTP it was created with (each round pins its own copy). Refused from
 *  second 88 of the round until the next round starts. */
export async function updateSpin2WinRtpAction(rtpPercentage: number): Promise<{
  success: boolean
  rtp: number | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { success: false, rtp: null, error: auth.error ?? 'Unauthorized' }

  // The database enforces this range too (CHECK on spin2win_config); validating
  // here just produces a friendlier message.
  if (!isValidRtp(rtpPercentage)) {
    return { success: false, rtp: null, error: 'RTP must be a number between 30 and 100.' }
  }
  if (serverSecondsInto(Date.now()) >= S2W_CONFIG_LOCK_SECOND) {
    return { success: false, rtp: null, error: CONFIG_LOCKED_MESSAGE }
  }

  try {
    const db = s2wDb()
    const { data, error } = await db
      .from('spin2win_config')
      .update({ rtp_percentage: rtpPercentage, updated_at: new Date().toISOString() })
      .eq('id', 'global')
      .select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length !== 1) throw new Error('the settings row was not found')

    await writeAuditLine(db, auth.user.id, `Spin2Win RTP target set to ${rtpPercentage}% — takes effect next round`)
    revalidatePath('/superadmin/live-game')
    return { success: true, rtp: rtpPercentage, error: null }
  } catch (err) {
    return { success: false, rtp: null, error: `Could not update Spin2Win RTP: ${errorText(err)}` }
  }
}

/** Sets the bonus (1 = N, 2 to 4) queued for the NEXT round. It returns to 1
 *  by itself once a round has been created with it. Refused from second 88 of
 *  the round until the next round starts. */
export async function updateSpin2WinNextBonusAction(bonus: number): Promise<{
  success: boolean
  bonus: number | null
  error: string | null
}> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error || !auth.user) return { success: false, bonus: null, error: auth.error ?? 'Unauthorized' }

  if (!isValidBonus(bonus)) {
    return { success: false, bonus: null, error: 'Bonus multiplier must be a whole number from 1 (N) to 4.' }
  }
  if (serverSecondsInto(Date.now()) >= S2W_CONFIG_LOCK_SECOND) {
    return { success: false, bonus: null, error: CONFIG_LOCKED_MESSAGE }
  }

  try {
    const db = s2wDb()
    const { data, error } = await db
      .from('spin2win_config')
      .update({ bonus_multiplier: bonus, updated_at: new Date().toISOString() })
      .eq('id', 'global')
      .select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length !== 1) throw new Error('the settings row was not found')

    await writeAuditLine(db, auth.user.id, `Spin2Win bonus multiplier set to ${bonusLabelLong(bonus)} — takes effect next round`)
    revalidatePath('/superadmin/live-game')
    return { success: true, bonus, error: null }
  } catch (err) {
    return { success: false, bonus: null, error: `Could not update Spin2Win bonus: ${errorText(err)}` }
  }
}

/**
 * Boosts the round ALREADY IN PROGRESS (1 to 4). Never writes spin2win_config:
 * the database function finds the current round itself, writes only that
 * round's own bonus, and refuses once the round is drawn. This action also
 * refuses from second 85, like the tab's "This round" lock.
 */
export async function applySpin2WinBonusToCurrentRoundAction(bonus: number): Promise<{
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
    return { success: false, roundNumber: null, bonus: null, error: 'Bonus multiplier must be a whole number from 1 (N) to 4.' }
  }
  if (serverSecondsInto(Date.now()) >= S2W_BOOST_LOCK_SECOND) {
    return { success: false, roundNumber: null, bonus: null, error: 'Locked — the draw is close. Try again next round.' }
  }

  try {
    const db = s2wDb()
    const { data: raw, error } = await db.rpc('spin2win_apply_bonus_to_current_round', { p_bonus: bonus })
    if (error) throw new Error(error.message)
    const result = asRpc<{ success: boolean; round_number?: number; bonus_multiplier?: number; error?: string }>(raw)

    if (!result.success) {
      const messages: Record<string, string> = {
        already_drawn: 'Too late — this round has already been drawn. Try again next round.',
        round_not_found: 'No active round found right now.',
        invalid_bonus: 'Bonus multiplier must be a whole number from 1 (N) to 4.',
      }
      return {
        success: false, roundNumber: result.round_number ?? null, bonus: null,
        error: messages[result.error ?? ''] ?? `Could not apply bonus: ${result.error}`,
      }
    }

    await writeAuditLine(
      db, auth.user.id,
      `Spin2Win bonus multiplier set to ${bonusLabelLong(bonus)} for the CURRENT round (#${result.round_number}) — takes effect immediately`
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

export interface Spin2WinPlayersResult {
  players: Spin2WinPlayerBet[]
  /** How many bets the round has in all (may be more than players.length). */
  total: number
  error: string | null
}

export async function getSpin2WinRoundPlayersAction(roundId: string): Promise<Spin2WinPlayersResult> {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return { players: [], total: 0, error: auth.error }

  if (typeof roundId !== 'string' || !UUID_PATTERN.test(roundId)) {
    return { players: [], total: 0, error: 'Invalid round.' }
  }

  try {
    const db = s2wDb()
    const [roundRes, betsRes] = await Promise.all([
      db.from('spin2win_rounds').select('winning_number').eq('id', roundId).single(),
      db.from('spin2win_bets')
        .select(`user_id, total_stake, total_payout, ${S2W_BET_COLUMNS.join(', ')}, profiles:user_id ( username )`,
          { count: 'exact' })
        .eq('round_id', roundId)
        .order('total_stake', { ascending: false })
        .limit(PLAYER_LIMIT),
    ])
    if (roundRes.error) throw new Error(`round: ${roundRes.error.message}`)
    if (betsRes.error) throw new Error(`bets: ${betsRes.error.message}`)

    const rows = (betsRes.data ?? []) as unknown as Spin2WinBetRow[]
    return {
      players: rows.map(r => shapePlayerBet(r, roundRes.data.winning_number)),
      total: betsRes.count ?? rows.length,
      error: null,
    }
  } catch (err) {
    return { players: [], total: 0, error: `Could not load players: ${errorText(err)}` }
  }
}
