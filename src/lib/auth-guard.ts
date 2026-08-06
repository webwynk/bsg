import { createClient as createServerSupabase } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side authorization guard. Every server action must begin with a call
 * to requireAuth() before touching the service-role client.
 *
 * S-3 FIX — this used to fall back to `user.user_metadata.role` whenever the
 * profile lookup failed:
 *
 *     if (profileError || !profile) {
 *       const userRole = user.user_metadata?.role       // user-writable!
 *       if (userRole && allowedRoles.includes(userRole)) return { user: ... }
 *     }
 *
 * `user_metadata` is self-service writable in Supabase — any authenticated user
 * can set it on themselves with `auth.updateUser({ data: { role: ... } })`. So
 * the last line of defence degraded to trusting attacker-controlled input the
 * moment a query failed. Authorization now FAILS CLOSED: if the profile cannot
 * be read, access is denied.
 */

export type AppRole = 'superadmin' | 'agent' | 'player'

export interface VerifiedUser {
  id: string
  email?: string
  role: AppRole
  username: string
  coin_balance: number
  is_active: boolean
  /** The agent this user reports to. Always null for agents and superadmins. */
  agent_id: string | null
}

export type AuthGuardResult =
  | { error: null; user: VerifiedUser }
  | { error: string; user: null }

export async function requireAuth(allowedRoles: AppRole[]): Promise<AuthGuardResult> {
  try {
    const supabase = await createServerSupabase()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return { error: 'Unauthorized: a valid authentication session is required.', user: null }
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!serviceRoleKey || !supabaseUrl) {
      return { error: 'Server configuration error: Supabase credentials missing.', user: null }
    }

    const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Only real columns are selected. The previous version selected `status`,
    // which does not exist, so this query always errored and every caller fell
    // through to the metadata path above (finding S-1).
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, username, role, coin_balance, is_active, agent_id')
      .eq('id', user.id)
      .single()

    // Fail closed. No fallback.
    if (profileError || !profile) {
      return { error: 'Unauthorized: account profile could not be verified.', user: null }
    }

    if (profile.is_active === false) {
      return { error: 'Forbidden: this account is suspended.', user: null }
    }

    if (!allowedRoles.includes(profile.role as AppRole)) {
      return { error: 'Forbidden: insufficient privileges for this action.', user: null }
    }

    return {
      error: null,
      user: {
        id: profile.id,
        email: user.email,
        role: profile.role as AppRole,
        username: profile.username,
        coin_balance: Number(profile.coin_balance ?? 0),
        is_active: profile.is_active,
        agent_id: profile.agent_id ?? null,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Authentication error: ${message}`, user: null }
  }
}
