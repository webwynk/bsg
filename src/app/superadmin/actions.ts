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
          time: new Date(item.created_at).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
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

export async function getSystemOverviewMetricsAction() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const allUsers = usersData?.users || []

      const agents = allUsers.filter(u => u.user_metadata?.role === 'agent')
      const players = allUsers.filter(u => u.user_metadata?.role === 'player')

      const agentCoins = agents.reduce((acc, u) => acc + Number(u.user_metadata?.balance || 0), 0)
      const playerCoins = players.reduce((acc, u) => acc + Number(u.user_metadata?.balance || 0), 0)
      const totalCoins = agentCoins + playerCoins

      // Today's Coins Issued (since 00:00:00 today)
      let todaysCoinsIssued = 0
      try {
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)

        const { data: txnsToday } = await supabaseAdmin
          .from('agent_coin_transactions')
          .select('amount')
          .eq('type', 'deposit')
          .gte('created_at', todayStart.toISOString())

        if (txnsToday) {
          todaysCoinsIssued = txnsToday.reduce((acc, tx) => acc + Number(tx.amount || 0), 0)
        }
      } catch (_) {}

      // Total bets (Sum of bet_amount in 24h) from game_history table
      let totalBets24h = 0
      try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: betsData } = await supabaseAdmin
          .from('game_history')
          .select('bet_amount')
          .gte('created_at', twentyFourHoursAgo)
        if (betsData) {
          totalBets24h = betsData.reduce((acc, row) => acc + Number(row.bet_amount || 0), 0)
        }
      } catch (_) {}

      return {
        totalCoins,
        todaysCoinsIssued,
        activeAgents: agents.length,
        activePlayers: players.length,
        totalBets24h
      }
    } catch (_) {}
  }

  return {
    totalCoins: 0,
    todaysCoinsIssued: 0,
    activeAgents: 0,
    activePlayers: 0,
    totalBets24h: 0
  }
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
        time: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }),
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

      // 1. Check admin user metadata first for exact custom float RTP
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const adminUser = usersData?.users.find(u => u.email === 'admin@bestsmartgame.com')
      if (adminUser?.user_metadata?.rtp !== undefined && adminUser?.user_metadata?.rtp !== null) {
        return { rtp: Number(adminUser.user_metadata.rtp) }
      }

      // 2. Check agent_configs table
      const { data } = await supabaseAdmin
        .from('agent_configs')
        .select('target_win_percentage')
        .limit(1)
        .maybeSingle()

      if (data?.target_win_percentage !== undefined && data?.target_win_percentage !== null) {
        return { rtp: Number(data.target_win_percentage) }
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

      // 1. Always update admin user metadata so custom float RTP is stored
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const adminUser = usersData?.users.find(u => u.email === 'admin@bestsmartgame.com')
      if (adminUser) {
        await supabaseAdmin.auth.admin.updateUserById(adminUser.id, {
          user_metadata: { ...adminUser.user_metadata, rtp: rtpValue }
        })
      }

      // 2. Also update agent_configs table for all agent profile IDs with onConflict constraint
      const { data: agentProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .in('role', ['agent', 'super_admin'])

      if (agentProfiles && agentProfiles.length > 0) {
        const rows = agentProfiles.map(p => ({
          agent_id: p.id,
          target_win_percentage: Math.round(rtpValue),
          updated_at: new Date().toISOString()
        }))
        await supabaseAdmin.from('agent_configs').upsert(rows, { onConflict: 'agent_id' })
      }

      await logAuditEventAction('System', `Global RTP target updated to ${rtpValue}%`)
    } catch (_) {}
  }

  revalidatePath('/superadmin')
  return { success: true, rtp: rtpValue }
}
