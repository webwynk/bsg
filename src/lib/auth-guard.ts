import { createClient as createServerSupabase } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export interface VerifiedUser {
  id: string
  email?: string
  role: 'superadmin' | 'agent' | 'player'
  username: string
  status: string
  parent_agent_id?: string | null
}

export type AuthGuardResult =
  | { error: null; user: VerifiedUser }
  | { error: string; user: null }

export async function requireAuth(allowedRoles: ('superadmin' | 'agent' | 'player')[]): Promise<AuthGuardResult> {
  try {
    const supabase = await createServerSupabase()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return { error: 'Unauthorized: Valid authentication session required.', user: null }
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return { error: 'Server Configuration Error: Missing SUPABASE_SERVICE_ROLE_KEY', user: null }
    }

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role, username, is_active, agent_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      const userRole = user.user_metadata?.role
      if (userRole && allowedRoles.includes(userRole as any)) {
        return {
          error: null,
          user: {
            id: user.id,
            email: user.email,
            role: userRole,
            username: user.user_metadata?.username || user.email?.split('@')[0] || 'User',
            status: user.user_metadata?.status || 'Active',
            parent_agent_id: user.user_metadata?.agent_id || user.user_metadata?.parent_agent_id || null,
          }
        }
      }
      return { error: 'Unauthorized: User profile not found.', user: null }
    }

    if (profile.is_active === false) {
      return { error: 'Forbidden: Account is suspended.', user: null }
    }

    if (!allowedRoles.includes(profile.role as any)) {
      return { error: 'Forbidden: Insufficient privileges for this action.', user: null }
    }

    return {
      error: null,
      user: {
        id: profile.id,
        email: user.email,
        role: profile.role as any,
        username: profile.username || user.user_metadata?.username || 'User',
        status: profile.is_active ? 'Active' : 'Blocked',
        parent_agent_id: profile.agent_id,
      },
    }
  } catch (err: any) {
    return { error: `Authentication error: ${err.message || 'Unknown error'}`, user: null }
  }
}
