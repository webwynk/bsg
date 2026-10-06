import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import {
  readMoneySummary,
  readPlayerMoneyRows,
  type MoneySummary,
  type PlayerMoneyRow,
} from '@/lib/money-totals-logic'

/**
 * Money totals -- the dashboard's one way to read bet and payout sums (Issue
 * #122). The database adds the bets up exactly, for Triple Chance AND Lucky
 * Card (staff_money_summary and staff_player_money_rows, migration
 * 20261007010000_staff_money_totals.sql); this file only calls them and turns
 * the answer into numbers. It replaces downloading every bet row and summing
 * in JavaScript, which silently stopped at 1,000 rows.
 *
 * Server-only and deliberately NOT a 'use server' file: it uses the service-role
 * client and trusts its caller, so it must only be called from server actions
 * that have already passed requireAuth().
 *
 * The untyped client is on purpose: database.types.ts does not know these two
 * functions (the same reason as the Lucky Card files, spec 17AO). The shape of
 * their answers is checked by the pure reader in money-totals-logic.ts and by a
 * real-database test.
 *
 * Both functions throw on a database error, like the queries they replace, so
 * each caller's own try/catch turns it into the page's error message.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient
}

/**
 * Bets and payouts of both games over three windows in one call:
 *   lifetime = everything; today = from `dayStart`; window = from `from` to `to`
 *   (both optional and inclusive; neither = the same as lifetime).
 * `agentId` null = every player, otherwise only that agent's players. The times
 * are ISO strings; `dayStart` is the start of today in India time, worked out by
 * the caller like every other day boundary on the dashboard.
 */
export async function fetchMoneySummary(args: {
  agentId?: string | null
  dayStart?: string | null
  from?: string | null
  to?: string | null
}): Promise<MoneySummary> {
  const { data, error } = await db().rpc('staff_money_summary', {
    p_agent_id: args.agentId ?? null,
    p_day_start: args.dayStart ?? null,
    p_from: args.from ?? null,
    p_to: args.to ?? null,
  })
  if (error) throw new Error(`money totals: ${error.message}`)
  return readMoneySummary(data)
}

/** One row per player of `agentId` who played in the window (both games combined). */
export async function fetchPlayerMoneyRows(
  agentId: string,
  from?: string | null,
  to?: string | null
): Promise<PlayerMoneyRow[]> {
  const { data, error } = await db().rpc('staff_player_money_rows', {
    p_agent_id: agentId,
    p_from: from ?? null,
    p_to: to ?? null,
  })
  if (error) throw new Error(`player money rows: ${error.message}`)
  return readPlayerMoneyRows(data)
}
