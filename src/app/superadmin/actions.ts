'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'

export async function getAuditLogsAction() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      // Try reading from audit_log table
      const { data, error } = await supabaseAdmin
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)

      if (!error && data && data.length > 0) {
        const logs = data.map(item => ({
          id: item.id,
          type: item.type || 'System',
          detail: item.detail,
          time: new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }))
        return { logs }
      }

      // Fallback: fetch from admin metadata
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const adminUser = usersData?.users.find(u => u.email === 'admin@bestsmartgame.com')
      if (adminUser && adminUser.user_metadata?.audit_logs) {
        return { logs: adminUser.user_metadata.audit_logs }
      }
    } catch (_) {}
  }
  return { logs: [] }
}

export async function logAuditEventAction(type: 'System' | 'Security' | 'Transaction', detail: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const newLog = {
        id: Math.random().toString(36).substring(2, 9),
        type,
        detail,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        created_at: new Date().toISOString()
      }

      // 1. Try inserting to audit_log table
      const { error: dbError } = await supabaseAdmin.from('audit_log').insert({
        type,
        detail,
        created_at: newLog.created_at
      })

      // 2. Also persist to admin user_metadata as fallback
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const adminUser = usersData?.users.find(u => u.email === 'admin@bestsmartgame.com')
      if (adminUser) {
        const currentLogs = adminUser.user_metadata?.audit_logs || []
        const updatedLogs = [newLog, ...currentLogs].slice(0, 20)
        await supabaseAdmin.auth.admin.updateUserById(adminUser.id, {
          user_metadata: {
            ...adminUser.user_metadata,
            audit_logs: updatedLogs
          }
        })
      }
    } catch (_) {}
  }
}

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

      await logAuditEventAction('System', `Global RTP target updated to ${rtpValue}%`)
    } catch (_) {}
  }

  revalidatePath('/superadmin')
  return { success: true, rtp: rtpValue }
}
