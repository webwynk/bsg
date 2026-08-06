import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * ⚠ DEAD ENDPOINT — RECOMMENDED FOR DELETION (mismatch M-6).
 *
 * This route duplicates the mobile login flow, but `bsg_app` does not call it:
 * ApiService.login talks to Supabase directly. It is therefore a second,
 * divergent implementation of the most security-sensitive operation in the
 * system, and every future auth rule has to be written twice or it applies to
 * only one path.
 *
 * It is also an unauthenticated POST endpoint that reaches for the service-role
 * key (to resolve the agent's display name), and unlike the app's own flow it
 * cannot enforce the single-device rule — that lives in the
 * check_and_update_login_session RPC, which only the app calls.
 *
 * Left in place only because this workspace is not under version control, so a
 * deletion here would be unrecoverable. Delete the file once it is in git.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { username, password } = body || {}

    if (!username || !password) {
      return NextResponse.json({ message: 'Username and password are required.' }, { status: 400 })
    }

    const email = username.includes('@') ? username : `${username.trim().toLowerCase()}@bestsmartgame.com`
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

    // Query real-time balance from public.profiles table
    let balance = Number(userMetadata.balance || 0)
    const { data: prof } = await supabase.from('profiles').select('balance, is_active').eq('id', user.id).single()
    if (prof) {
      balance = Number(prof.balance || 0)
      if (!prof.is_active) {
        return NextResponse.json({ message: 'Account is blocked. Please contact your Agent.' }, { status: 403 })
      }
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
        balance,
        // M-6 FIX: the Flutter UserModel.fromJson reads snake_case 'agent_name'.
        // This route emitted camelCase 'agentName', so even if the app were
        // pointed at it the field would have been dropped. Both keys are sent
        // for one release so nothing breaks if another consumer exists.
        agent_name: agentName,
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

