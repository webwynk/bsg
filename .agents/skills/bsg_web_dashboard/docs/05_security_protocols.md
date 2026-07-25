# SECURITY PROTOCOLS

Security here is layered defense-in-depth, not one big control: authentication, input validation, authorization, database constraints, and rate limiting each assume the others might fail. This document is written to be consistent with the decisions already made in the Frontend, Database Schema, and Backend/API specs — where the original draft contradicted one of those (flagged inline below), this rewrite resolves it in favor of the canonical, single-source-of-truth implementation rather than describing a second, competing version of the same control.

**The single most important rule in this entire document, stated first because it's the one mistake that bypasses every other control:** in a Supabase project there are two API keys with radically different power. The **anon key** is safe to ship in a client bundle *because* RLS constrains what it can do. The **service_role key bypasses RLS entirely** — it can read and write every row in every table, including every balance. It must never appear in the Flutter app, the Next.js client bundle, a public repo, or a log line. It lives only in server-side environment variables, used only inside `SECURITY DEFINER` RPC calls and other trusted server code. If this key ever leaks, rotate it immediately — every other control in this document is secondary to keeping this one secret.

---

## 1. Secrets & Key Management

* **Never in client code:** `service_role` key, database connection strings, any third-party API secret. Client-side code (web bundle *and* the Flutter app) only ever holds the `anon` key plus a user's own session token.
* **Environment separation:** distinct Supabase projects (or at minimum distinct keys/credentials) for local development, staging, and production. A developer's local `.env` should never be able to touch production data.
* **`.env` files are git-ignored**, always — enforce with a pre-commit hook (`git-secrets` or `gitleaks`) that scans for accidentally-committed keys, not just a `.gitignore` line someone can forget.
* **Rotation plan:** document who can rotate the `service_role` key and the Supabase JWT signing secret, and under what conditions (suspected leak, employee offboarding). A key with no rotation plan is a key you can't actually revoke in an incident.

---

## 2. Authentication & Session Security

This section is rewritten to match the Backend/API Spec's decision to use **Supabase Auth**, not a hand-rolled JWT system — the original draft described building custom short-lived-token-plus-refresh-rotation logic, which duplicates what Supabase's auth client already does (`autoRefreshToken`, refresh token rotation, revocation on sign-out) and reopens the risk of getting token handling subtly wrong.

* **Tokens:** Supabase issues a short-lived access JWT (default 1 hour) and a longer-lived refresh token. Rotation is handled by the Supabase client SDK, not custom application code.
* **Dashboard storage:** tokens are **never** in `localStorage` or `sessionStorage` — stored only in an **HttpOnly, Secure** cookie, set via the Supabase SSR helper on the Next.js server. This makes the token invisible to any JavaScript running on the page, which is what actually neutralizes XSS-based token theft (an XSS bug can still run arbitrary JS, but it cannot read an HttpOnly cookie).
* **`SameSite`: use `Lax`, not `Strict`, unless you've confirmed no flow relies on a top-level cross-site redirect (e.g. an email magic-link landing back on the dashboard).** `Strict` silently breaks cookie delivery on that first redirect; `Lax` still blocks the cross-site `POST` forgery pattern that matters for CSRF.
* **CSRF is a separate control from `SameSite`, not a side effect of it:** state-changing Server Actions on the dashboard get Next.js's built-in Origin-header verification for free. Anything still exposed as a public `app/api/` Route Handler and driven by a cookie-authenticated session (not a Bearer token) should independently verify the request's `Origin`/`Referer` before executing a mutation.
* **Mobile (Flutter) storage:** `flutter_secure_storage`, which is backed by Android Keystore / iOS Keychain — never plain `SharedPreferences`, which is unencrypted on disk.
* **Session revocation:** logging out (dashboard or mobile) must invalidate the refresh token server-side (`supabase.auth.signOut()` with the appropriate scope), not just clear it locally — otherwise a stolen refresh token remains valid after the legitimate user "logs out."
* **Mobile transport hardening:** enforce TLS certificate pinning in the Flutter app for calls to your API domain. This is what stops a MITM attack on a compromised network (e.g. a malicious Wi-Fi AP) from intercepting tokens even over HTTPS with a rogue CA cert installed on the device.

---

## 3. Transport & Network Security

Not present in the original draft — added because it's the layer underneath everything else here.

* **TLS everywhere**, HSTS enabled (`Strict-Transport-Security` header) on the dashboard domain so browsers refuse to fall back to plain HTTP even on a typo'd URL.
* **CORS:** API routes intended for the mobile app allow only your app's known origin/bundle identifier — not `*`. Server Actions aren't cross-origin callable at all, which is itself a security property, not just an architectural choice.
* **Security headers** on the dashboard via Next.js middleware: `Content-Security-Policy` (restrict script sources — this is your actual second line of defense against XSS, complementing HttpOnly cookies), `X-Frame-Options: DENY` (clickjacking), `X-Content-Type-Options: nosniff`.

---

## 4. Request Validation (Zod)

Every endpoint — Route Handler or Server Action — parses its input through a strict Zod schema before touching any business logic, shared with the client-side form schema (per Frontend Spec §3.5) so the two never drift apart:

```typescript
const TransferSchema = z.object({
  playerId: z.string().uuid(),
  amount: z.number().positive('Amount must be greater than 0').finite().max(100_000),
  type: z.enum(['deposit', 'withdrawal']),
});
```

**Important scope correction:** this schema stops a malformed or negative `amount` from ever reaching business logic — it is the *first* line of defense against the "negative amount" hack, not the thing that ultimately prevents it. The actual authority on whether a transfer is allowed is the `transfer_points` RPC in the Database Schema doc, which independently checks ownership, sufficient balance inside a locked transaction. Treat Zod as **shape and range validation at the edge**, and the database as **the source of truth on business rules** — never assume that because input passed Zod, the operation is authorized or affordable.

---

## 5. Authorization & Row Level Security (RLS)

RLS is the layer that holds even if application code has a bug — but it must describe the *actual* write paths this system uses, which the original draft's Policy 2 did not.

* **Policy 1 — reads scoped to relationship:** Agents `SELECT` from `profiles` only where `profiles.agent_id = auth.uid()`; players `SELECT` only their own row. (Full policy SQL: Database Schema §1.1.)
* **Policy 2, corrected — no direct client INSERT into `transactions` at all, for anyone, including agents.** The original draft's "agents can INSERT into transactions if the target player's agent_id matches" describes exactly the write path the Database Schema and Backend specs deliberately closed off: a direct client-side insert has no way to also atomically lock the row and check the balance — it's the same double-spend gap money-movement logic exists to prevent. All ledger writes happen exclusively inside the `SECURITY DEFINER` `transfer_points` / `process_bet` RPCs, which bypass RLS *because* they, not the client, are the trusted boundary. The correct RLS posture on `transactions` is: **SELECT policies only; INSERT/UPDATE/DELETE revoked from `authenticated`/`anon` entirely.**
* **Policy 3 — players `SELECT` only their own `game_history`**, same reasoning as Policy 2: no client-side INSERT policy exists here either; only `process_bet` writes rows.
* **`agent_configs` (RTP) is readable by the owning agent, writable only by `super_admin`** — see Database Schema §1.2. This table is more sensitive than general profile data and should be reviewed on its own whenever RLS policies are audited.

---

## 6. Concurrency & Race Condition Protection

* **The attack the original draft describes is real:** two `spin` requests for the same user arriving within the same millisecond, both reading a balance before either write lands, both proceeding as if the full balance were still available.
* **The fix already lives in one place — don't implement it a second time.** The Database Schema's `process_bet` and `transfer_points` RPCs use `SELECT ... FOR UPDATE` to lock the row for the duration of the transaction, so a second concurrent request blocks until the first commits and then reads the *post-update* balance. The original draft's alternative suggestion — a single `UPDATE ... WHERE balance >= amount` — is a legitimate pattern in isolation, but describing it here as a second option invites someone to implement an ad-hoc version of it in a different code path later, drifting out of sync with the RPC's logic (e.g. forgetting the ledger insert). **There is exactly one code path that is allowed to move money: the RPCs.** Every API route calls them; nothing re-derives the locking logic independently.
* **This is a different problem from idempotency, and both are needed:** row locking (above) protects against two *distinct, legitimate* concurrent requests racing each other. Idempotency keys (Backend/API Spec §3.4) protect against the *same* logical request being retried by a flaky mobile client and executed twice. Losing either one reopens a double-spend path.

---

## 7. Rate Limiting & Abuse Prevention

* **Redis-backed (Upstash or equivalent)** limiter applied at the middleware layer, keyed by user ID for authenticated routes and by IP for pre-auth routes.
* **Login:** max 5 attempts / 5 minutes per IP+username combination (tighter than IP alone, so one bad actor can't lock out unrelated accounts sharing a NAT'd IP, e.g. a corporate network or VPN exit node). Layer this on top of, not instead of, Supabase Auth's own built-in throttling.
* **Spin:** max 1 request per 3 seconds per user ID — this is the endpoint most exposed to an automated client, since it's driven by a mobile app whose traffic pattern you don't fully control.
* **Behind a reverse proxy / CDN:** rate limiting by IP requires trusting `X-Forwarded-For` — only trust it if the proxy in front of the app is the one setting it (e.g. Vercel's edge network), never trust a client-supplied `X-Forwarded-For` directly, or IP-based limiting becomes trivially spoofable.
* **Escalating response, not just a hard block:** repeated login failures beyond the rate limit should trigger a short account-level cooldown and, optionally, a CAPTCHA challenge on the next attempt — a bare 429 with no escalation is easy to route around with a slow-and-steady retry schedule.

---

## 8. Audit Logging & Monitoring

Not present in the original draft — added because "prevent" and "detect" are both required; this system already has the data model for it (Database Schema §1.5, `audit_log`).

* Every non-financial administrative action (block/unblock a player, change an agent's `target_win_percentage`, create/deactivate an agent) writes a row to `audit_log` with actor, target, and before/after values.
* **Alert, don't just log**, on: a spike in the `spin` endpoint's error rate (Backend/API Spec §3.5 — a proxy for a bug in money-moving logic), repeated `INSUFFICIENT_BALANCE` responses from a single agent in a short window (possible probing), and any `service_role` key usage from an unexpected source.
* **Never log:** full JWTs, passwords, or raw amounts in a way that reconstructs a full financial history in a third-party log aggregator outside the primary database's access controls.

---

## 9. Dependency & Supply Chain Security

Not present in the original draft.

* Lockfile (`pnpm-lock.yaml`) committed and enforced in CI (`pnpm install --frozen-lockfile`) — no silent dependency drift between a developer's machine and production.
* Automated vulnerability scanning on every PR (Dependabot or Snyk) with a policy for how quickly a critical CVE in a direct dependency must be patched — a system moving real money is a more attractive target for a supply-chain compromise than an average app, so this isn't optional tooling.
* Any raw SQL that isn't going through the Supabase client's parameterized query builder or a `plpgsql` function parameter (never string-concatenated) is a SQL injection risk — there should be effectively zero hand-built SQL strings with interpolated user input anywhere in this codebase.

---
