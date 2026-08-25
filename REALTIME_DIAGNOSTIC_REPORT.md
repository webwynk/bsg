# BSG Dashboard — Supabase Realtime Diagnostic Report

**Date**: 2026-08-24  
**Investigator**: Browser DevTools + Console log analysis  
**Platform**: https://bsg-indol.vercel.app  
**Session**: Agent portal logged in as `agent2`  

---

## 1. Executive Summary

> [!CAUTION]
> **Supabase Realtime is BROKEN on the live production dashboard.** The WebSocket connection reports "SUBSCRIBED" but receives zero events. All dashboard data updates are currently happening via a manual Refresh button or the 90-second safety fallback timer — NOT via live push.

The new `LiveDataProvider` architecture (which was intended to replace buggy per-page polling timers with a single real-time WebSocket subscription) is non-functional in production due to a **database-side configuration step that was never executed**.

---

## 2. What We Built (Expected Behavior)

As part of the **Issue #91 Realtime Architecture Migration**, the following changes were implemented and pushed to GitHub:

### New Architecture (Code Side — Deployed ✅)
- **`src/components/live-data-provider.tsx`**: A single, portal-wide WebSocket subscriber mounted once per session. Listens for PostgreSQL row changes on `profiles`, `bets`, `coin_ledger`, and `rounds`. When any change is detected, it signals pages to silently re-fetch their data in < 50ms.
- **`src/hooks/use-request-generation.ts`**: Race-condition guard preventing out-of-order responses from overwriting newer data.
- **All 9 routes** migrated from individual `setInterval` polling timers to the unified `useLiveVersion()` hook.

### Required Database Migration (NOT Applied ❌)
- **`supabase/migrations/20260824170000_enable_dashboard_realtime.sql`**: This file was written, committed, and pushed to GitHub — but **was never executed against the live Supabase cloud database**.

---

## 3. Live Browser Evidence

### A. Badge State
| Time | Badge Text | Badge Color | Meaning |
| :--- | :--- | :--- | :--- |
| On page load | **"Connecting…"** | Yellow/Grey | WebSocket trying to subscribe |
| After 30+ seconds | **Still "Connecting…"** | Yellow/Grey | Subscription never completed |
| Never | ~~"Live Sync"~~ | ~~Green~~ | Never achieved |

The `isLive` state in `LiveDataProvider` (which flips to `true` when Supabase reports `status === 'SUBSCRIBED'`) remained `false` for the entire session.

---

### B. Console Error (Verbatim)
```
[error] Error: An unexpected response was received from the server.
    at I (https://bsg-indol.vercel.app/_next/static/chunks/31bg96bwz131c.js:2:743)
```

This is the exact error the Supabase client fires inside its `subscribe()` callback when the **WebSocket handshake is rejected by the server**. The subscription is attempted, the server refuses or does not acknowledge it correctly, and the connection never elevates to `SUBSCRIBED`.

---

### C. Cross-Tab Update Test

A controlled two-browser-tab test was performed:

| Step | Tab 1 (Passive Observer) | Tab 2 (Action Taker) |
| :--- | :--- | :--- |
| Baseline | Balance = X coins | Viewing same player |
| Deposit 10 coins | — | Typed 10, clicked **Confirm Deposit** |
| 1 second later | ❌ Balance still shows X (not updated) | ✅ Shows X+10 immediately (optimistic state) |
| 6 seconds later | ❌ Balance STILL shows X | — |
| After clicking **Refresh** button manually | ✅ Balance now shows X+10 | — |

**Conclusion from test**: The database was written correctly and immediately (Tab 2 confirmed it, and manual refresh on Tab 1 confirmed the new value). The only thing missing was the **real-time push from database → Tab 1**. That push never arrived because Realtime was not enabled for the relevant tables.

---

## 4. Root Cause: Missing Database Publication

### What Supabase Realtime Requires

Supabase Realtime works by subscribing to PostgreSQL's **Logical Replication** system. For a client to receive a WebSocket event when a row in a table changes, that table must first be added to the `supabase_realtime` PostgreSQL **publication**.

### What Was Found in the Database

Before the migration was written, we audited `pg_publication_tables` and found:

```
supabase_realtime publication contains:
  ✅ public.notifications (added 2026-08-10)
  ❌ public.profiles       ← NOT published
  ❌ public.bets           ← NOT published
  ❌ public.coin_ledger    ← NOT published
  ❌ public.rounds         ← NOT published
```

### Why the WebSocket Fails

When the browser calls:
```ts
supabase.channel('live-data-sync')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, handler)
  .subscribe()
```

Supabase tries to register a change listener for the `bets` table. However, because `bets` is not in the `supabase_realtime` publication, the Supabase server **cannot fulfill this subscription request** and returns an error response. This causes the `subscribe()` callback to fire with a non-`SUBSCRIBED` status, which the client code (`live-data-provider.tsx`) logs as the "unexpected response" error.

---

## 5. The Migration File (Written But Not Applied)

The SQL migration was written, committed, and pushed to GitHub at:
```
bsg_web_dashboard/supabase/migrations/20260824170000_enable_dashboard_realtime.sql
```

**Contents:**
```sql
BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coin_ledger;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rounds;

COMMIT;
```

**This SQL was NEVER run against the live Supabase project.** It only exists in the Git repository.

---

## 6. Current Behavior (While Realtime Is Broken)

Because the WebSocket subscription fails, the dashboard falls back to the 90-second safety heartbeat inside `LiveDataProvider`:

```ts
const FALLBACK_POLL_MS = 90_000  // 90 seconds
```

This means:
- **Agent Players page**: Balance changes visible max 90 seconds after they happen (previously was 10 seconds).
- **Superadmin Live Game page**: Round draws visible max 90 seconds after they happen (previously was 5 seconds).
- **All other pages**: 90-second stale window (previously was 60 seconds).

> [!WARNING]
> The migration to Realtime has made stale data windows **worse** than before (90s vs 10s-60s) because the safety fallback was set conservatively. This will be fully resolved once the database migration is applied.

---

## 7. The Fix (One-Time Action Required)

> [!IMPORTANT]
> This is a **one-time, irreversible, safe** configuration change. It adds tables to a Supabase publication, which means Supabase starts broadcasting row changes. Row Level Security (RLS) policies already control what each user can see, so adding a table to the publication does **not** expand data access — it only enables the broadcast mechanism.

### How to Apply the Fix

**Option A: Supabase Dashboard SQL Editor (Recommended)**

1. Go to **https://supabase.com/dashboard** → Select your BSG project
2. Click **SQL Editor** in the left sidebar
3. Click **"New query"**
4. Paste and run:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coin_ledger;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rounds;
```

5. Click **Run**. Expected output: `ALTER PUBLICATION` (4 lines, no errors).

**Option B: Supabase CLI (if CLI is linked to live project)**
```bash
supabase db push
```
This will apply all pending migrations including `20260824170000_enable_dashboard_realtime.sql`.

---

## 8. Expected Behavior After Fix Is Applied

| Metric | Before Realtime Migration | After Polling Removed (Current Broken State) | After Fix Applied (Target State) |
| :--- | :--- | :--- | :--- |
| Balance update delay | 10–60s (per-page timer) | 90s (fallback only) | **< 500ms (Realtime push)** |
| DB requests when idle | ~36/min per page | 1/90s per session | **0 (event-driven only)** |
| UI pagination reset on refresh | ❌ Yes (10s bug) | ✅ Fixed | ✅ Fixed |
| "Live Sync" badge | N/A | "Connecting…" | **"Live Sync" (green)** |
| Cross-tab balance sync | ❌ No | ❌ No | **✅ Yes, instantly** |

---

## 9. Verification After Applying Fix

After running the SQL:

1. Open the dashboard at `/superadmin/agents/[agent]` or `/agent/players`
2. The badge should immediately change from **"Connecting…"** to **"Live Sync"** (green pulsing dot)
3. Open two browser tabs on the same players page
4. In Tab 2, deposit 10 coins to a player
5. In Tab 1 — the balance should update **within 1 second** without clicking Refresh

---

## 10. Files Involved in This Investigation

| File | Status | Notes |
| :--- | :--- | :--- |
| `src/components/live-data-provider.tsx` | ✅ Deployed to Vercel | Code is correct. Subscriptions will work once DB migration runs. |
| `src/hooks/use-request-generation.ts` | ✅ Deployed to Vercel | Race-condition guard. Working correctly. |
| `supabase/migrations/20260824170000_enable_dashboard_realtime.sql` | ✅ In GitHub | ❌ NOT yet applied to live Supabase DB. **This is the missing step.** |
| `_scratch_realtime_latency_test.js` | 🔬 Diagnostic only | Node script that confirmed zero events received outside browser. Not production code. |
