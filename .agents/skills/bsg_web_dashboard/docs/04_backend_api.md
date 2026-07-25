# BACKEND & API DEVELOPMENT

This document assumes the Frontend Spec (§3.5, Server Actions over API Routes) and Database Schema (§3, RPC functions) as prerequisites. The single biggest correction in this rewrite: **the original spec re-implemented the balance-check → roll → update logic in Node, as separate steps.** That's exactly the race condition the database schema's `for update` row-locking was built to prevent — splitting it across a Node process undoes that guarantee. The fix throughout this document is the same idea: **one atomic call to the Postgres RPC, not an orchestration of steps in application code.**

---

## 1. Architecture & When to Use a Route Handler at All

* **Execution environment:** Node.js runtime (not Edge) for routes touching the DB via the Supabase server client or doing RNG/crypto work — the Edge runtime's limited Node API surface isn't worth fighting for this workload.
* **Route Handlers (`app/api/`) are reserved for endpoints that a non-Next.js caller must reach over plain HTTP:**
  * The **Flutter mobile app** — it can't call a Next.js Server Action, so anything mobile touches (`/api/auth/*`, `/api/game/spin`) must be a real Route Handler.
  * Third-party **webhooks** (payment provider callbacks).
* **Everything else — actions only ever triggered from the web dashboard (e.g. an admin editing an agent's config) — should be a Server Action**, per the Frontend Spec, not a Route Handler. Don't create a public HTTP endpoint for something only your own authenticated dashboard ever calls; every additional public endpoint is additional attack surface (CORS, rate limiting, auth replay — all need re-solving per route).
* **Agent Transfers:** Agents transfer points *only* from the web dashboard. Therefore, transfers are handled entirely via Next.js Server Actions (as detailed in the Frontend Spec §3.5), not via a public `app/api/` Route Handler.
* **Versioning:** prefix mobile-facing routes with `/api/v1/...` from day one. You cannot force every installed mobile app to update instantly the way you can redeploy a web dashboard; a version prefix is what lets you change a payload shape later without breaking users on an old app build.

---

## 2. Authentication — Use Supabase Auth, Not Hand-Rolled Bcrypt + JWT

The original spec's `/api/auth/login` manually verifies a bcrypt hash and mints its own JWT. **Remove this entirely.** The Database Schema document already moved off a hand-rolled `password_hash` column onto `auth.users` (§1.1) — reintroducing custom hashing and token-signing here contradicts that decision and reopens the exact liability it closed: you'd now own password hashing correctness, token expiry/rotation, and revocation, none of which Supabase's implementation needs you to write.

### 2.1 `POST /api/v1/auth/login`

```ts
// app/api/v1/auth/login/route.ts
import { createServerClient } from '@/lib/supabase/server';
import { loginSchema } from '@/features/auth/schema';

export async function POST(req: Request) {
  const parsed = loginSchema.safeParse(await req.json());
  if (!parsed.success) {
    return jsonError('INVALID_INPUT', parsed.error.flatten(), 400);
  }

  const supabase = createServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.username, // see note below on username vs. email
    password: parsed.data.password,
  });

  if (error) {
    // Supabase already rate-limits repeated failed attempts per account —
    // don't leak whether it was "user not found" vs "wrong password".
    return jsonError('INVALID_CREDENTIALS', 'Incorrect username or password.', 401);
  }

  // Web dashboard: Supabase's SSR helper sets the HttpOnly, Secure, SameSite=Lax
  // session cookie automatically as part of signInWithPassword when called
  // through the server client — no manual cookie-setting code needed here.

  // Mobile: return the session tokens in the body. The Flutter app must use
  // Supabase's mobile SDK (or flutter_secure_storage) to persist them —
  // never plain SharedPreferences, which is unencrypted on the device.
  return Response.json({
    success: true,
    data: { session: data.session, user: { id: data.user.id, role: data.user.user_metadata.role } },
  });
}
```

**Note on `username` vs. Supabase Auth's native `email` field:** Supabase Auth is built around email identity. If usernames must be the login identifier (per the Design System's agent-login flow), map `username → synthetic-internal email` at signup time (e.g. `username@internal.yourapp`) rather than building a parallel credential system — this keeps you on Supabase's maintained auth path instead of forking off it.

---

## 3. API Conventions (apply to every route below)

These were entirely absent from the original spec and are what make the API predictable to build a frontend against and safe to expose to a mobile client you don't fully control the version of.

### 3.1 Response envelope
```ts
type ApiSuccess<T> = { success: true; data: T };
type ApiError = { success: false; error: { code: string; message: string; details?: unknown } };
```
Every route returns one of these two shapes — never a bare array, never an unwrapped object — so client code can branch on `success` without per-endpoint guessing.

### 3.2 Error mapping
Postgres exceptions raised with a custom `errcode` (per the DB schema's `process_bet`/`transfer_points`, e.g. `P0001` insufficient balance, `P0002` daily limit exceeded) must be caught and mapped to the correct HTTP status — not allowed to fall through as a generic 500:

| Postgres errcode | HTTP status | `error.code` |
|---|---|---|
| `P0001` insufficient balance | 402 (or 400) | `INSUFFICIENT_BALANCE` |
| Unhandled | 500 | `INTERNAL_ERROR` (generic message only — never forward the raw Postgres error string to the client) |

### 3.3 Rate limiting
Applied via middleware (e.g. Upstash Redis token-bucket) keyed by user ID (authenticated routes) or IP (login):
* `/api/v1/auth/login` — throttle aggressively (e.g. 5 attempts / 5 min per IP+username combo). This is defense-in-depth on top of Supabase's own throttling, not a replacement for it.
* `/api/v1/game/spin` — throttle per user to a sane max spins/second. This is the endpoint most exposed to an automated client hammering it, since it's the one consumed by a mobile app you don't control the traffic pattern of.

### 3.4 Idempotency
`transfer` and `spin` are both "move money" operations that a flaky mobile network will cause clients to retry. Require an `Idempotency-Key` header on both; store `(key, response)` for a short TTL (e.g. 24h) and replay the stored response for a repeated key instead of re-executing the mutation. Without this, a double-tap or a retried request on a bad connection double-charges or double-spins.

### 3.5 Observability
Every request gets a correlation/request ID (log it, and echo it back in the response for support/debugging). Structured JSON logs, not `console.log`. **Never log full JWTs, passwords, or raw Postgres error text.** Alert on the `game/spin` route's 5xx rate specifically and separately from the rest of the API — a spike there is a direct signal of a bug in money-moving logic, not routine noise.

---

## 4. `POST /api/v1/game/spin` — The Math Engine, Rewritten

This is the highest-consequence endpoint in the system, so it gets the most scrutiny.

### 4.1 What was wrong with the original design
The original spec's steps — (2) read config, (3) check balance, (4) roll in Node, (5) separately update balance and insert history — are **four to five independent round trips**, not one transaction. Between step 3 (balance check) and step 5 (balance update), nothing locks the row: two concurrent spin requests for the same user can both read a sufficient balance, both proceed, and both debit — an overdraw, and the exact double-spend class the Database Schema doc's `for update` locking exists to prevent. Splitting money-critical logic between Node and Postgres like this reopens a bug the schema already closed.

### 4.2 The fix: one RPC call
All of the roll logic, balance check, balance update, and ledger inserts described in the original Node code already live inside `process_bet` in the Database Schema document (§3.1), wrapped in a single locked transaction. The Route Handler's job shrinks to: authenticate, validate, rate-limit, call the RPC once, return the result.

```ts
// app/api/v1/game/spin/route.ts
import { requireRole } from '@/lib/auth/guards';
import { spinSchema } from '@/features/game/schema';

export async function POST(req: Request) {
  const session = await requireRole(req, 'player');

  const idempotencyKey = req.headers.get('Idempotency-Key');
  if (!idempotencyKey) return jsonError('MISSING_IDEMPOTENCY_KEY', 'Required header missing.', 400);
  const cached = await getIdempotentResponse(idempotencyKey);
  if (cached) return Response.json(cached);

  const parsed = spinSchema.safeParse(await req.json());
  // Zod: singleBets, doubleBets, tripleBets maps (e.g. { "7": 10 })
  if (!parsed.success) return jsonError('INVALID_INPUT', parsed.error.flatten(), 400);

  const supabase = createServerClient();
  const { data: agentId } = await supabase
    .from('profiles')
    .select('agent_id')
    .eq('id', session.user.id)
    .single();

  const { data: result, error } = await supabase.rpc('process_bet', {
    p_user_id: session.user.id,
    p_agent_id: agentId,
    p_single_bets: parsed.data.singleBets,
    p_double_bets: parsed.data.doubleBets,
    p_triple_bets: parsed.data.tripleBets,
  });

  if (error) return mapPostgresError(error);

  const response = {
    success: true,
    data: {
      red: result.red_digit,
      green: result.green_digit,
      black: result.black_digit,
      winAmount: result.win_amount,
    },
  };
  await storeIdempotentResponse(idempotencyKey, response);
  return Response.json(response);
}
```

Note what's deliberately **not** sent back to the client: `is_forced_loss` and the agent's `target_win_percentage`. The app only needs `red`, `green`, `black` digits to drive the 3-ring wheel animation and `winAmount` to update the displayed balance — internal RTP mechanics have no reason to ever be present in a client-inspectable API response or mobile app network trace.


### 4.3 On the RNG itself
`Math.random()` (Node) and Postgres's default `random()` are both fast, non-cryptographic PRNGs — fine for e.g. randomizing a UI animation, not something you want as the sole audit basis for a real-money outcome generator. Two concrete improvements:
* Seed the roll from a cryptographically secure source (Postgres's `pgcrypto` extension, e.g. deriving from `gen_random_bytes()`, or Node's `crypto.randomInt` if the roll happens in application code instead) rather than the default PRNG.
* If this system is ever subject to gaming-license certification, licensing bodies typically require an independently certified RNG module and a documented, auditable fairness process — worth confirming with whoever holds the operating license before this ships, since it can dictate which RNG implementation is acceptable.

### 4.4 Latency budget, revisited
The original "< 100ms" target is more achievable with this rewrite, not less: it's now **one network round trip** (Node → Postgres RPC → response) instead of the original's multiple sequential reads/writes. Two things matter for hitting it in practice:
* Use Supabase's connection pooler (PgBouncer, transaction mode) — a cold direct connection per request is the most common source of surprise latency, not the query itself.
* Keep the Node route itself free of any work heavier than validation — no synchronous crypto, no blocking calls — before the RPC round trip.

---
