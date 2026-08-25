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
 *
 * Realtime hardening (Issue #91 addendum): `worker: true` runs the socket's
 * heartbeat off the main thread, per Supabase's own guidance, so a busy or
 * backgrounded tab can't starve it into a silent transport-level drop.
 * `heartbeatCallback` reconnects immediately on a detected disconnect
 * instead of waiting for the next natural reconnect attempt. Neither of
 * these addresses Issue #91's actual root cause (a server-side
 * authorization check failing silently on an otherwise-healthy connection,
 * invisible to any client-side heartbeat) -- that's what useLiveSync's
 * guaranteed poll is for -- but this closes a separate, real gap the same
 * investigation's research surfaced.
 */
export function createBrowserSupabaseClient() {
  const client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      realtime: {
        worker: true,
        heartbeatCallback: (status) => {
          if (status === 'disconnected') client.realtime.connect()
        },
      },
    }
  )
  return client
}
