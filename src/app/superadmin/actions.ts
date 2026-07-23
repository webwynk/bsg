'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'

export async function getRtpAction() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
      const { data } = await supabaseAdmin
        .from('agent_configs')
        .select('target_win_percentage')
        .limit(1)
        .single()

      if (data?.target_win_percentage) {
        return { rtp: data.target_win_percentage }
      }
    } catch (_) {}
  }
  return { rtp: 96.5 }
}

export async function updateRtpAction(rtpValue: number) {
  if (rtpValue < 50 || rtpValue > 99.9) {
    return { error: 'RTP must be between 50% and 99.9%' }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      // Update or insert default system config
      const { error } = await supabaseAdmin
        .from('agent_configs')
        .upsert({ target_win_percentage: rtpValue, updated_at: new Date().toISOString() })

      if (error) {
        // Store in user_metadata of admin if table does not exist
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
        const adminUser = usersData?.users.find(u => u.email === 'admin@bestsmartgame.com')
        if (adminUser) {
          await supabaseAdmin.auth.admin.updateUserById(adminUser.id, {
            user_metadata: { ...adminUser.user_metadata, rtp: rtpValue }
          })
        }
      }
    } catch (_) {}
  }

  revalidatePath('/superadmin')
  return { success: true, rtp: rtpValue }
}
