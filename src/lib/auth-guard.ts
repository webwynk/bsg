import { cookies } from 'next/headers'
import { createClient as createServerSupabase } from '@/lib/supabase'
import { asRpc, type StaffAuthCheckResult } from '@/lib/rpc'
import { STAFF_SESSION_COOKIE } from '@/lib/staff-session'

/**
 * Server-side authorization guard. Every server action must begin with a call
 * to requireAuth() before touching the service-role client.
 *
 * Issue #93 FIX — this used to do 3 fully separate DB round-trips on every
 * call (auth.getUser(), an admin-client profiles select, and a separate
 * staff_session_touch RPC call), with zero sharing across the several actions
 * a single page load or 3-second live-sync poll fires -- confirmed live to be
 * the actual cause of slow route loads and sluggish refreshes dashboard-wide.
 * The profile select + session-token check are now one round-trip via the
 * staff_auth_check RPC (SECURITY DEFINER, mirrors bsg_app's proven
 * session_heartbeat) -- see 20260825170000_staff_auth_check_rpc.sql and
 * MASTER_AUDIT_AND_REMEDIATION_PLAN.md Issue #93. No SUPABASE_SERVICE_ROLE_KEY
 * dependency here anymore: the RPC's own SECURITY DEFINER replaces what the
 * admin client was doing, so this function no longer needs the service-role
 * credential at all.
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

    // Session cookie is read before the role is even known -- staff_auth_check
    // only consults it for agent/superadmin roles, but reading it here (a pure
    // cookie-jar lookup, no round-trip) lets one RPC call cover every role.
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get(STAFF_SESSION_COOKIE)?.value ?? null

    const { data: checkData, error: checkError } = await supabase.rpc('staff_auth_check', {
      p_session_token: sessionToken,
    })

    // Fail closed. No fallback.
    if (checkError || !checkData) {
      return { error: 'Unauthorized: account profile could not be verified.', user: null }
    }

    const check = asRpc<StaffAuthCheckResult>(checkData)

    if (!check.profile_found) {
      return { error: 'Unauthorized: account profile could not be verified.', user: null }
    }

    if (check.is_active === false) {
      return { error: 'Forbidden: this account is suspended.', user: null }
    }

    if (!allowedRoles.includes(check.role as AppRole)) {
      return { error: 'Forbidden: insufficient privileges for this action.', user: null }
    }

    // Single-device enforcement for staff -- confirms this request is still
    // coming from the device that most recently logged in, not a session
    // that's since been superseded by a login elsewhere. Scoped to
    // agent/superadmin only: players are untouched, they don't carry this
    // cookie at all (bsg_app has its own, entirely separate session
    // mechanism, never this cookie), and requireAuth is never actually
    // called with 'player' in allowedRoles anywhere in the dashboard today
    // -- but scoping explicitly by role here, rather than assuming that
    // stays true forever, means it can't silently start doing the wrong
    // thing if that ever changes.
    if (check.role === 'agent' || check.role === 'superadmin') {
      if (!sessionToken) {
        return { error: 'Unauthorized: no active session found. Please sign in again.', user: null }
      }

      if (!check.session_valid) {
        return { error: 'Unauthorized: signed in from another device. Please sign in again.', user: null }
      }
    }

    return {
      error: null,
      user: {
        id: check.id,
        email: user.email,
        role: check.role as AppRole,
        username: check.username,
        coin_balance: Number(check.coin_balance ?? 0),
        is_active: check.is_active,
        agent_id: check.agent_id ?? null,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: `Authentication error: ${message}`, user: null }
  }
}
