import type { createAdminClient } from './supabase'

/**
 * Account IDs (R01, P07) for dashboard screens. Display only: the database
 * assigns them (20261031120000_account_codes.sql) and nothing here writes one.
 */

/** Shown when an account has no ID yet, so a screen never breaks without one. */
export const NO_ACCOUNT_CODE = '-'

export function accountCodeLabel(code: string | null | undefined): string {
  return code || NO_ACCOUNT_CODE
}

/** Whether a search box entry matches an ID. Any case, ignoring outer spaces. */
export function accountCodeMatches(code: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q !== '' && (code ?? '').toLowerCase().includes(q)
}

/**
 * The IDs of the given accounts, by account id. Scoped to those accounts. A
 * failed read gives an empty map: the screens then show NO_ACCOUNT_CODE instead
 * of failing, because an ID must never stop a coin or status screen loading.
 */
export async function fetchAccountCodes(
  db: Pick<ReturnType<typeof createAdminClient>, 'from'>,
  accountIds: string[],
): Promise<Map<string, string>> {
  if (accountIds.length === 0) return new Map()
  try {
    const { data, error } = await db.from('account_codes').select('user_id, code').in('user_id', accountIds)
    if (error) {
      console.error('fetchAccountCodes:', error.message)
      return new Map()
    }
    return new Map((data ?? []).map(row => [row.user_id, row.code]))
  } catch (err) {
    console.error('fetchAccountCodes:', err)
    return new Map()
  }
}
