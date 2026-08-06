import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/database.types'

/**
 * Both Supabase clients are typed against the generated `Database` schema.
 *
 * This is the mechanical guard against the defect class that produced S-1 and
 * S-4: supabase-js resolves with `{ data: null, error }` instead of throwing,
 * so `.select('role, status')` and `.or('...parent_agent_id...')` — neither
 * column existing — failed silently and slid into fallbacks. Typed clients turn
 * both into compile errors.
 *
 * Regenerate `database.types.ts` after every migration.
 */

/**
 * Cookie-bound client carrying the CALLER'S session.
 *
 * Use this for anything where the database must know who is acting — every
 * money RPC derives identity from auth.uid(). Using the service-role client for
 * those would leave the database unable to identify the actor, which is how v1
 * ended up permitting unauthenticated coin minting.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component, where cookies are read-only.
          }
        },
      },
    }
  )
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only ever use this AFTER requireAuth() has authorised the caller, and only
 * for reads or Auth admin operations. Holding this key is not an identity:
 * never treat "called with the service key" as "is a superadmin".
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase service credentials are not configured.')
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
