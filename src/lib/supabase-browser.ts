import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'

/**
 * Browser-only client, for client components that need something the
 * request-scoped server client (lib/supabase.ts, which imports next/headers
 * and can't be used from "use client" code) can't provide -- currently just
 * Realtime subscriptions. Uses the same cookie-based session the server
 * client reads, via @supabase/ssr's browser cookie adapter, so there's no
 * separate sign-in step -- it's already authenticated as whoever is logged
 * in for this browser tab.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
