import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { username, password } = body || {}

    if (!username || !password) {
      return NextResponse.json({ message: 'Username and password are required.' }, { status: 400 })
    }

    const email = username.includes('@') ? username : `${username.trim().toLowerCase()}@bsg.com`
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    // Standard client to sign in with password
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData.user || !authData.session) {
      return NextResponse.json({ message: authError?.message || 'Invalid username or password.' }, { status: 401 })
    }

    const user = authData.user
    const userMetadata = user.user_metadata || {}

    // Account block check
    if (userMetadata.status === 'Blocked') {
      return NextResponse.json({ message: 'Account is blocked. Please contact your Agent.' }, { status: 403 })
    }

    // Role check: ensure user is a player
    if (userMetadata.role && userMetadata.role !== 'player') {
      return NextResponse.json({ message: 'Only player accounts can log into the mobile app.' }, { status: 403 })
    }

    // Fetch Agent Name
    let agentName = 'N/A'
    if (userMetadata.agent_id && serviceRoleKey) {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
      const { data: agentData } = await supabaseAdmin.auth.admin.getUserById(userMetadata.agent_id)
      if (agentData?.user) {
        agentName = agentData.user.user_metadata?.full_name || agentData.user.user_metadata?.username || 'Agent'
      }
    }

    return NextResponse.json({
      token: authData.session.access_token,
      user: {
        id: user.id,
        username: userMetadata.username || username,
        name: userMetadata.full_name || username,
        balance: userMetadata.balance || 0,
        agentName,
        status: userMetadata.status || 'Active',
      },
      sessionStartAt: new Date().toISOString()
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
