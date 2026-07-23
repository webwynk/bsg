'use server'

import { createClient as createServerClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

export async function getAgentDashboardDataAction() {
  const supabase = await createServerClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    return { balance: 0, playersCount: 0 }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(authUser.id)
      const freshUser = userData?.user || authUser
      const balance = freshUser.user_metadata?.balance || 0

      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const players = (usersData?.users || []).filter(
        u => u.user_metadata?.role === 'player' && u.user_metadata?.agent_id === authUser.id
      )

      return {
        balance,
        playersCount: players.length,
        username: freshUser.user_metadata?.username || freshUser.email?.split('@')[0] || 'agent'
      }
    } catch (_) {}
  }

  return {
    balance: authUser.user_metadata?.balance || 0,
    playersCount: 0,
    username: authUser.user_metadata?.username || 'agent'
  }
}
