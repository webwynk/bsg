import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) {
      return NextResponse.json({ message: 'Invalid or expired session token.' }, { status: 401 })
    }

    const userMetadata = user.user_metadata || {}

    if (userMetadata.status === 'Blocked') {
      return NextResponse.json({ message: 'Account is blocked.' }, { status: 403 })
    }

    return NextResponse.json({
      id: user.id,
      username: userMetadata.username || user.email?.split('@')[0] || 'player',
      name: userMetadata.full_name || userMetadata.username || 'Player',
      balance: userMetadata.balance || 0,
      status: userMetadata.status || 'Active',
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
