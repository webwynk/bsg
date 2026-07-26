'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'

export async function logAuditEventAction(type: string, detail: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      // Insert into audit_log table
      try {
        await supabaseAdmin.from('audit_log').insert({ type, detail })
      } catch (_) {}

      // Also append to admin user metadata fallback
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const adminUser = usersData?.users.find(u => u.email === 'admin@bestsmartgame.com')

      if (adminUser) {
        const existingLogs = adminUser.user_metadata?.audit_logs || []
        const newLog = {
          id: Math.random().toString(36).substring(2, 9),
          time: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }),
          type,
          detail,
          created_at: new Date().toISOString()
        }
        const updatedLogs = [newLog, ...existingLogs].slice(0, 30)

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

      // Calculate Asia/Kolkata (IST - UTC+5:30) today start (00:00:00 IST)
      const now = new Date()
      const istTodayString = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // 'YYYY-MM-DD'
      const istTodayStart = new Date(`${istTodayString}T00:00:00+05:30`)
      const todayStartISO = istTodayStart.toISOString()

      // Execute all database queries in parallel via Promise.all
      const [profilesRes, txnsRes, allBetsRes, todayBetsRes] = await Promise.all([
        supabaseAdmin.from('profiles').select('role, balance'),
        supabaseAdmin.from('agent_coin_transactions').select('amount').eq('type', 'deposit').gte('created_at', todayStartISO),
        supabaseAdmin.from('game_history').select('bet_amount, win_amount'),
        supabaseAdmin.from('game_history').select('bet_amount, win_amount').gte('created_at', todayStartISO)
      ])

      let totalCoins = 0
      let activeAgents = 0
      let activePlayers = 0

      if (profilesRes.data && profilesRes.data.length > 0) {
        for (const p of profilesRes.data) {
          totalCoins += Number(p.balance || 0)
          if (p.role === 'agent') activeAgents++
          if (p.role === 'player') activePlayers++
        }
      } else {
        // Fallback to Auth listUsers if profiles table query returns empty
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
        const allUsers = usersData?.users || []
        const agents = allUsers.filter(u => u.user_metadata?.role === 'agent')
        const players = allUsers.filter(u => u.user_metadata?.role === 'player')
        activeAgents = agents.length
        activePlayers = players.length
        totalCoins = allUsers.reduce((acc, u) => acc + Number(u.user_metadata?.balance || 0), 0)
      }

      // Today's coins issued (resets daily at 00:00 IST)
      const todaysCoinsIssued = txnsRes.data ? txnsRes.data.reduce((acc, tx) => acc + Number(tx.amount || 0), 0) : 0

      // Overall Lifetime Gameplay Stats
      const allSpins = allBetsRes.data || []
      const totalBetsCount = allSpins.length
      const totalBetCoins = allSpins.reduce((acc, s) => acc + Number(s.bet_amount || 0), 0)
      const totalWinCoins = allSpins.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
      const totalLostCoins = totalBetCoins - totalWinCoins

      // Today IST Gameplay Stats
      const todaySpins = todayBetsRes.data || []
      const todayBetsCount = todaySpins.length
      const todayBetCoins = todaySpins.reduce((acc, s) => acc + Number(s.bet_amount || 0), 0)
      const todayWinCoins = todaySpins.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
      const todayLostCoins = todayBetCoins - todayWinCoins

      return {
        totalCoins,
        todaysCoinsIssued,
        activeAgents,
        activePlayers,
        totalBetsCount,
        totalBetCoins,
        totalWinCoins,
        totalLostCoins,
        todayBetsCount,
        todayBetCoins,
        todayWinCoins,
        todayLostCoins
      }
    } catch (_) {}
  }

  return {
    totalCoins: 0,
    todaysCoinsIssued: 0,
    activeAgents: 0,
    activePlayers: 0,
    totalBetsCount: 0,
    totalBetCoins: 0,
    totalWinCoins: 0,
    totalLostCoins: 0,
    todayBetsCount: 0,
    todayBetCoins: 0,
    todayWinCoins: 0,
    todayLostCoins: 0
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

      // Query agent_configs table
      const { data, error } = await supabaseAdmin
        .from('agent_configs')
        .select('rtp_percentage')
        .maybeSingle()

      if (!error && data?.rtp_percentage !== undefined) {
        return { rtp: Number(data.rtp_percentage) }
      }

      // Fallback: query admin user metadata
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const adminUser = usersData?.users.find(u => u.email === 'admin@bestsmartgame.com')
      if (adminUser?.user_metadata?.rtp !== undefined) {
        return { rtp: Number(adminUser.user_metadata.rtp) }
      }
    } catch (_) {}
  }

  return { rtp: 96.5 }
}

export async function updateRtpAction(rtpPercentage: number) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      // Upsert into agent_configs table
      await supabaseAdmin
        .from('agent_configs')
        .upsert({ id: 'global_system_config', rtp_percentage: rtpPercentage, updated_at: new Date().toISOString() })

      // Update admin user metadata & append audit log
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const adminUser = usersData?.users.find(u => u.email === 'admin@bestsmartgame.com')

      if (adminUser) {
        const existingLogs = adminUser.user_metadata?.audit_logs || []
        const newLog = {
          id: Math.random().toString(36).substring(2, 9),
          time: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }),
          type: 'System',
          detail: `Global RTP target updated to ${rtpPercentage}%`,
          created_at: new Date().toISOString()
        }

        const updatedLogs = [newLog, ...existingLogs].slice(0, 30)

        await supabaseAdmin.auth.admin.updateUserById(adminUser.id, {
          user_metadata: {
            ...adminUser.user_metadata,
            rtp: rtpPercentage,
            audit_logs: updatedLogs
          }
        })

        // Also insert into audit_log table if exists
        try {
          await supabaseAdmin.from('audit_log').insert({
            type: 'System',
            detail: `Global RTP target updated to ${rtpPercentage}%`
          })
        } catch (_) {}
      }

      revalidatePath('/superadmin')
      return { success: true, rtp: rtpPercentage }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  return { success: false, error: 'Database service role key missing' }
}

export async function getLatestGameDrawsAction() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  try {
    let dbRows: any[] = []
    if (serviceRoleKey && supabaseUrl) {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data } = await supabaseAdmin
        .from('game_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)

      dbRows = data || []
    }

    const nowSecs = Math.floor(Date.now() / 1000)
    const currentRoundStartSecs = nowSecs - (nowSecs % 103)

    // Generate 10 continuous 24/7 rounds (current round + last 9 rounds)
    const draws = []
    const usedDbIds = new Set<string>()

    for (let i = 0; i < 10; i++) {
      const roundTimeSecs = currentRoundStartSecs - (i * 103)
      const roundIsoDate = new Date(roundTimeSecs * 1000).toISOString()

      // Check if DB has a real player spin near this round timestamp (within 103s)
      const dbMatch = dbRows.find(row => {
        if (!row.created_at || usedDbIds.has(row.id)) return false
        const rowSecs = Math.floor(new Date(row.created_at).getTime() / 1000)
        return Math.abs(rowSecs - roundTimeSecs) <= 51 || Math.abs(rowSecs - (roundTimeSecs + 103)) <= 51
      })

      if (dbMatch) {
        usedDbIds.add(dbMatch.id)
        const resNum = dbMatch.result_number !== null && dbMatch.result_number !== undefined
          ? Number(dbMatch.result_number)
          : Math.abs((roundTimeSecs * 137 + 42) % 1000)
        const resStr = resNum.toString().padStart(3, '0')
        const red = dbMatch.red_digit !== null && dbMatch.red_digit !== undefined ? dbMatch.red_digit : parseInt(resStr[0], 10)
        const green = dbMatch.green_digit !== null && dbMatch.green_digit !== undefined ? dbMatch.green_digit : parseInt(resStr[1], 10)
        const black = dbMatch.black_digit !== null && dbMatch.black_digit !== undefined ? dbMatch.black_digit : parseInt(resStr[2], 10)

        draws.push({
          id: dbMatch.id,
          game: dbMatch.game_name || 'Triple Chance',
          resultNumber: resNum,
          redDigit: red,
          greenDigit: green,
          blackDigit: black,
          betAmount: Number(dbMatch.bet_amount || 0),
          winAmount: Number(dbMatch.win_amount || 0),
          status: dbMatch.status || (Number(dbMatch.win_amount || 0) > 0 ? 'WON' : 'LOST'),
          playerUsername: dbMatch.user_username || 'player',
          createdAt: dbMatch.created_at
        })
      } else {
        // Continuous 24/7 Global Round generator for rounds with no player bets
        const roundNum = Math.floor(roundTimeSecs / 103)
        const pseudoRes = Math.abs((roundNum * 317 + 89) % 1000)
        const resStr = pseudoRes.toString().padStart(3, '0')

        draws.push({
          id: `round_${roundNum}`,
          game: 'Triple Chance',
          resultNumber: pseudoRes,
          redDigit: parseInt(resStr[0], 10),
          greenDigit: parseInt(resStr[1], 10),
          blackDigit: parseInt(resStr[2], 10),
          betAmount: 0,
          winAmount: 0,
          status: 'COMPLETED',
          playerUsername: 'Global Round',
          createdAt: roundIsoDate
        })
      }
    }

    return { draws }
  } catch (_) {
    return { draws: [] }
  }
}
