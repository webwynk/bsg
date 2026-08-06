'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/auth-guard'

export async function logAuditEventAction(type: string, detail: string) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) return

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
  const auth = await requireAuth(['superadmin'])
  if (auth.error) {
    return { logs: [] }
  }

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
  const auth = await requireAuth(['superadmin'])
  if (auth.error) {
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

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      // Calculate Asia/Kolkata (IST - UTC+5:30) today start (00:00:00 IST)
      const now = new Date()
      const istTodayString = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const istTodayStart = new Date(`${istTodayString}T00:00:00+05:30`)
      const todayStartISO = istTodayStart.toISOString()

      const [profilesRes, txnsRes, roundBetsRes, todayRoundBetsRes] = await Promise.all([
        supabaseAdmin.from('profiles').select('role, balance').range(0, 999999),
        supabaseAdmin.from('transactions').select('amount').eq('type', 'admin_adjustment').gte('amount', 0).gte('created_at', todayStartISO).range(0, 999999),
        supabaseAdmin.from('triple_chance_bets').select('total_stake, win_amount').range(0, 999999),
        supabaseAdmin.from('triple_chance_bets').select('total_stake, win_amount').gte('created_at', todayStartISO).range(0, 999999)
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
      const roundSpins = roundBetsRes.data || []
      const totalBetsCount = roundSpins.length
      const totalBetCoins = roundSpins.reduce((acc, s) => acc + Number(s.total_stake || 0), 0)
      const totalWinCoins = roundSpins.reduce((acc, s) => acc + Number(s.win_amount || 0), 0)
      const totalLostCoins = totalBetCoins - totalWinCoins

      // Today IST Gameplay Stats
      const todaySpins = todayRoundBetsRes.data || []
      const todayBetsCount = todaySpins.length
      const todayBetCoins = todaySpins.reduce((acc, s) => acc + Number(s.total_stake || 0), 0)
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
  const auth = await requireAuth(['superadmin'])
  if (auth.error) {
    return { rtp: 96.0 }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data, error } = await supabaseAdmin
        .from('agent_configs')
        .select('rtp_percentage, target_win_percentage')
        .or('agent_id.is.null,id.eq.global_system_config')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!error && data) {
        const val = data.target_win_percentage ?? data.rtp_percentage
        if (val !== undefined && val !== null) {
          return { rtp: Number(val) }
        }
      }

      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const adminUser = usersData?.users.find(u => u.email === 'admin@bestsmartgame.com')
      if (adminUser?.user_metadata?.rtp !== undefined) {
        return { rtp: Number(adminUser.user_metadata.rtp) }
      }
    } catch (_) {}
  }

  return { rtp: 96.0 }
}

export async function updateRtpAction(rtpPercentage: number) {
  const auth = await requireAuth(['superadmin'])
  if (auth.error) {
    return { success: false, error: auth.error }
  }

  if (typeof rtpPercentage !== 'number' || rtpPercentage < 50 || rtpPercentage > 100) {
    return { success: false, error: 'Invalid RTP value. Must be between 50% and 100%.' }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (serviceRoleKey && supabaseUrl) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      await supabaseAdmin
        .from('agent_configs')
        .upsert({
          id: 'global_system_config',
          rtp_percentage: rtpPercentage,
          target_win_percentage: rtpPercentage,
          updated_at: new Date().toISOString()
        })

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
  const auth = await requireAuth(['superadmin'])
  if (auth.error) {
    return { draws: [], activeRound: null }
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  if (!serviceRoleKey || !supabaseUrl) {
    return { draws: [], activeRound: null }
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    let roundRows: any[] = []
    try {
      const { data, error } = await supabaseAdmin
        .from('triple_chance_rounds')
        .select('*, triple_chance_bets(*)')
        .order('created_at', { ascending: false })
        .limit(20)
      if (error || !data || data.length === 0) {
        const { data: fallbackData } = await supabaseAdmin
          .from('triple_chance_rounds')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)
        roundRows = fallbackData || []
      } else {
        roundRows = data || []
      }
    } catch (_) {}

    const aggregatedDraws = roundRows.map(row => {
      const red = row.red !== null && row.red !== undefined ? Number(row.red) : 0
      const green = row.green !== null && row.green !== undefined ? Number(row.green) : 0
      const black = row.black !== null && row.black !== undefined ? Number(row.black) : 0
      const resNum = (row.result_number !== null && row.result_number !== undefined)
        ? Number(row.result_number)
        : (red * 100 + green * 10 + black)

      const bets = (row.triple_chance_bets || []) as any[]
      const sKey = `${black}`
      const dKey = `${green}${black}`
      const tKey = `${red}${green}${black}`

      const playerBets = bets.map(b => {
        const singleBetsObj = (b.single_bets || {}) as Record<string, number>
        const doubleBetsObj = (b.double_bets || {}) as Record<string, number>
        const tripleBetsObj = (b.triple_bets || {}) as Record<string, number>

        const sBet = Number(singleBetsObj[sKey] || singleBetsObj[parseInt(sKey, 10).toString()] || 0)
        const dBet = Number(
          doubleBetsObj[dKey] || 
          doubleBetsObj[dKey.padStart(2, '0')] || 
          doubleBetsObj[parseInt(dKey, 10).toString()] || 0
        )
        const tBet = Number(
          tripleBetsObj[tKey] || 
          tripleBetsObj[tKey.padStart(3, '0')] || 
          tripleBetsObj[parseInt(tKey, 10).toString()] || 0
        )

        let winAmt = 0
        if (red !== null && green !== null && black !== null) {
          winAmt = (sBet * 9) + (dBet * 90) + (tBet * 900)
        } else {
          winAmt = Number(b.win_amount || 0)
        }

        const profileObj = Array.isArray(b.profiles) ? (b.profiles[0] || {}) : (b.profiles || {})
        const username = profileObj.username || 'player'

        return {
          username,
          betAmount: Number(b.total_stake || 0),
          winAmount: winAmt,
          status: winAmt > 0 ? 'WON' : 'LOST'
        }
      })

      const playerCount = bets.length
      const totalWagered = bets.reduce((acc, b) => acc + Number(b.total_stake || 0), 0)
      const totalPayout = playerBets.reduce((acc, b) => acc + b.winAmount, 0)

      let playerUsername = 'System (No Bets)'
      if (playerCount === 1) {
        playerUsername = bets[0].profiles?.username ? `@${bets[0].profiles.username}` : '@player1'
      } else if (playerCount > 1) {
        playerUsername = `👥 ${playerCount} Players`
      }

      return {
        id: row.id || `round_${row.round_number}`,
        roundNumber: row.round_number,
        game: 'Triple Chance',
        resultNumber: resNum,
        redDigit: red,
        greenDigit: green,
        blackDigit: black,
        betAmount: totalWagered,
        winAmount: totalPayout,
        playerCount,
        status: totalPayout > 0 ? 'WON' : (totalWagered > 0 ? 'LOST' : 'COMPLETED'),
        playerUsername,
        playerBets,
        createdAt: row.created_at || row.scheduled_at || new Date().toISOString()
      }
    })

    let activeRound: any = null
    try {
      const { data: curRoundData } = await supabaseAdmin.rpc('get_current_round')
      if (curRoundData) {
        const hasDigits = curRoundData.red !== null && curRoundData.red !== undefined &&
                          curRoundData.green !== null && curRoundData.green !== undefined &&
                          curRoundData.black !== null && curRoundData.black !== undefined
        const red = hasDigits ? Number(curRoundData.red) : null
        const green = hasDigits ? Number(curRoundData.green) : null
        const black = hasDigits ? Number(curRoundData.black) : null
        activeRound = {
          roundNumber: curRoundData.round_number,
          roundId: curRoundData.round_id,
          hasDigits,
          redDigit: red,
          greenDigit: green,
          blackDigit: black,
          resultNumber: hasDigits ? (red! * 100 + green! * 10 + black!) : null,
          status: curRoundData.status,
          secondsRemaining: curRoundData.seconds_remaining,
          scheduledAt: curRoundData.scheduled_at
        }
      }
    } catch (_) {}

    return { draws: aggregatedDraws, activeRound }
  } catch (_) {
    return { draws: [], activeRound: null }
  }
}
