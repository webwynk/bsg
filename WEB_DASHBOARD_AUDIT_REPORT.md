# `bsg_web_dashboard` — Raw Codebase Audit Report

Companion to `DATABASE_AUDIT_REPORT.md` (Supabase SQL migrations) and `bsg_app/AUDIT_REPORT.md` (Flutter mobile client). This report audits the Next.js/TypeScript web dashboard source, file-by-file, cross-checked against both prior reports for RPC-contract, role, and schema alignment. No fixes are applied here — findings only.

---

## Table of Contents

- [1. Entry Points (`src/middleware.ts`, `src/app/layout.tsx`, `src/app/page.tsx`)](#file-1)
  - [1.1 `src/middleware.ts` (File 1)](#file-1)
  - [1.2 `src/app/layout.tsx` (File 2)](#file-2)
  - [1.3 `src/app/page.tsx` (File 3)](#file-3)
- [2. `src/app/superadmin/*`](#file-4)
  - [2.1 `src/app/superadmin/layout.tsx` (File 4)](#file-4)
  - [2.2 `src/app/superadmin/login/page.tsx` (File 5)](#file-5)
  - [2.3 `src/app/superadmin/login/actions.ts` (File 6)](#file-6)
  - [2.4 `src/app/superadmin/page.tsx` (File 7)](#file-7)
  - [2.5 `src/app/superadmin/actions.ts` (File 8)](#file-8)
  - [2.6 `src/app/superadmin/agents/page.tsx` (File 9)](#file-9)
  - [2.7 `src/app/superadmin/agents/actions.ts` (File 10)](#file-10)
  - [2.8 `src/app/superadmin/agents/[agentUsername]/page.tsx` (File 11)](#file-11)
  - [2.9 `src/app/superadmin/agents/issued/page.tsx` (File 12)](#file-12)
  - [2.10 `src/app/superadmin/live-game/page.tsx` (File 13)](#file-13)
- [3. `src/app/actions/`](#file-14)
  - [3.1 `src/app/actions/auth.ts` (File 14)](#file-14)
- [4. `src/app/agent/*`](#file-15)
  - [4.1 `src/app/agent/layout.tsx` (File 15)](#file-15)
  - [4.2 `src/app/agent/login/page.tsx` (File 16)](#file-16)
  - [4.3 `src/app/agent/login/actions.ts` (File 17)](#file-17)
  - [4.4 `src/app/agent/page.tsx` (File 18)](#file-18)
  - [4.5 `src/app/agent/actions.ts` (File 19)](#file-19)
  - [4.6 `src/app/agent/history/page.tsx` (File 20)](#file-20)
  - [4.7 `src/app/agent/players/actions.ts` (File 21)](#file-21)
  - [4.8 `src/app/agent/players/[[...slug]]/page.tsx` (File 22)](#file-22)
  - [4.9 `src/app/agent/profit/actions.ts` (File 23)](#file-23)
  - [4.10 `src/app/agent/profit/page.tsx` (File 24)](#file-24)
- [5. `src/app/api/*`](#file-25)
  - [5.1 `src/app/api/auth/login/route.ts` (File 25)](#file-25)
  - [5.2 `src/app/api/auth/logout/route.ts` (File 26)](#file-26)
  - [5.3 `src/app/api/user/profile/route.ts` (File 27)](#file-27)
- [6. `src/lib/*`](#file-28)
  - [6.1 `src/lib/auth-guard.ts` (File 28)](#file-28)
  - [6.2 `src/lib/supabase.ts` (File 29)](#file-29)
  - [6.3 `src/lib/rpc.ts` (File 30)](#file-30)
  - [6.4 `src/lib/ledger.ts` (File 31)](#file-31)
  - [6.5 `src/lib/database.types.ts` (File 32)](#file-32)
  - [6.6 `src/lib/utils.ts` (File 33)](#file-33)
- [7. `src/components/*`](#file-34)
  - [7.1 `src/components/responsive-pagination.tsx` (File 34)](#file-34)
  - [7.2 `src/components/theme-provider.tsx` and `src/components/theme-toggle.tsx` (File 35-36)](#file-35)
  - [7.3 `src/components/ui/*` (button, input, label, card, slider, dialog, popover, select, table, calendar) (File 37-46)](#file-37)
- [8. Consolidated Cross-Codebase Findings](#section-47-consolidated-cross-codebase-findings)
- [9. Bonus Scope: Root-Level Tooling Scripts](#file-47)
  - [9.1 `apply_sql_to_live_db.js` (File 47)](#file-47)
  - [9.2 `scripts/gen-db-types.js` (File 48)](#file-48)
  - [9.3 `next.config.ts` (File 49)](#file-49)

*(Merged from the now-removed `WEB_DASHBOARD_AUDIT_SUMMARY.md`, confirmed via diff to be identical in substance to this report — only the Table of Contents and heading-numbering format differed. This file is now the single source of truth for the web dashboard audit.)*

---

## Group: Entry Points (`src/middleware.ts`, `src/app/layout.tsx`, `src/app/page.tsx`)

<a id="file-1"></a>
## File 1 — `src/middleware.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `middleware()` (default export, Next.js middleware entry), `config.matcher`.
- **Database & Backend Connections:** `supabase.auth.getUser()` via a request-scoped `createServerClient` (from `@supabase/ssr`), reading `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Reads `user.app_metadata.role` only — no table/RPC calls.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Runs on every request matched by `config.matcher` (everything except `/api`, `/_next/static`, `/_next/image`, `favicon.ico`, `sitemap.xml`, `robots.txt`). Builds a per-request Supabase SSR client wired to the request/response cookie jar, resolves the current user, and gates `/agent/*` and `/superadmin/*` by `app_metadata.role`. Uses the anon key + user's own cookies, so this call is subject to RLS — it's just reading the authenticated user's own session, not querying a table.
- **Non-Coder:** This is the dashboard's front-door bouncer. Before any admin or agent page loads, it checks "are you logged in, and are you the right kind of user for this door?" and redirects you to the correct login page or home area if not.

### Section 3: Dashboard Functionality Structure (Step-by-Step)
1. **Root redirect** — `/` → `/agent/login` unconditionally.
2. **Bypass list** — any pathname containing `/login`, or starting with `/_next` / `/api`, or matching a static-asset extension regex, skips all auth logic and passes through.
3. **Supabase env guard** — if `NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` are unset, silently passes the request through with no auth check at all.
4. **SSR client + `getUser()`** — resolves the current session's user (or `null`), reading the role from `user.app_metadata.role` (not `user_metadata` — see below).
5. **`/superadmin/*` guard** — no user → redirect to `/superadmin/login`. User present but role is a truthy value other than `'superadmin'` → redirect `'agent'` role to `/agent`, everything else to `/superadmin/login`.
6. **`/agent/*` guard** — no user → redirect to `/agent/login`. `'superadmin'` role → redirect to `/superadmin`. `'player'` role → redirect back to `/agent/login`.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Fail-open on missing env vars (line 28-30).** If the Supabase env vars are absent at runtime, the middleware returns `response` (pass-through) instead of blocking — every `/agent` and `/superadmin` route becomes unauthenticated-accessible. This is a misconfiguration scenario, not a normal-operation bug, but there's no fail-closed default; a bad deploy (missing/rotated env var) silently disables all page-level auth instead of erroring or blocking.
- **Falsy-role bypass in the `/superadmin` guard (line 73).** The check is `if (userRole && userRole !== 'superadmin')`. If `userRole` is `undefined`/`null`/`''` (falsy) — i.e., a logged-in user whose `app_metadata.role` was never set or not yet synced — this branch is skipped entirely and the user falls through to the end of the function, landing on `return response`, i.e. **access granted** to `/superadmin/*`. The no-`user` case is caught above, but a logged-in user with no role claim is not. Given the DB audit confirms `handle_new_user` always mirrors a clamped role into `app_metadata` (File 7), this needs a live account with `app_metadata.role` absent to be exploitable in practice — but the guard as written is not strict-by-default (should be "reject unless role === 'superadmin'", not "reject only if role is truthy and wrong").
- **JWT staleness window** — already identified and scoped in `DATABASE_AUDIT_REPORT.md` File 7: a role demotion can lag up to the JWT's remaining TTL before this middleware sees the new role, but every server action independently re-verifies via `requireAuth()` against live `profiles` data (per the code comment at lines 62-64, to be confirmed when `auth-guard.ts` is audited).

**🗑️ Unused / Dead Code** — none in this file.

**⚔️ Functionality Conflicts** — none within this file; the `/agent` and `/superadmin` guards are mutually exclusive by path prefix.

**🔗 Mobile App & Database Misalignment**
- **Consistent** with `bsg_app/AUDIT_REPORT.md`: mobile sessions are documented as always `role: 'player'`, enforced server-side by `session_login` — matching this middleware's explicit `'player'` → bounce-to-`/agent/login` branch (a player token should never grant dashboard access).
- **Consistent** with `DATABASE_AUDIT_REPORT.md` File 7: this file is the exact named target of the `S-2` fix (reading `app_metadata` instead of client-writable `user_metadata`); the DB report's own audit of this line (`middleware.ts:65`) confirms the field name and rationale match the trigger (`sync_role_to_app_metadata`) that keeps it in sync with `profiles.role`.
- The DB report's claim that "server actions independently re-verify through `requireAuth()`" (cited from this file's own comment) is a dependency on `lib/auth-guard.ts`, not yet audited in this pass — flagged to verify when that file is reached, since it's load-bearing for why the falsy-role bypass above doesn't escalate to an actual data-mutation risk.

---

<a id="file-2"></a>
## File 2 — `src/app/layout.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `RootLayout` (default export), `metadata` (Next.js `Metadata` export), `dmSans` (font loader instance).
- **DB/Backend connections:** none.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Standard Next.js App Router root layout — loads the DM Sans variable font, sets page `<title>`/description metadata, wraps all pages in `ThemeProvider` (light/dark/system), applies base HTML/body classes (full-height flex column, background/foreground tokens).
- **Non-Coder:** This is the outer picture-frame every page sits inside — it sets the font, the light/dark mode switch, and the page title/description shown in the browser tab and search results.

### Section 3: Structure
1. **Font setup** — DM Sans via `next/font/google`, exposed as CSS variable `--font-dm-sans`.
2. **Metadata** — static title "Best Smart Game Dashboard" / description "Administrative Back Office & God Mode Control Portal".
3. **Theme wiring** — `ThemeProvider` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none; this is inert boilerplate with no data flow.

**🗑️ Unused / Dead Code** — none in this file itself, but note the `metadata.description` ("God Mode Control Portal") is an internal-sounding label shipped to the public `<meta>` tag / any indexer — cosmetic/informational, not a functional bug.

**⚔️ Functionality Conflicts** — none.

**🔗 Mobile App & Database Misalignment** — N/A, no backend interaction.

---

<a id="file-3"></a>
## File 3 — `src/app/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `Home` (default export).
- **DB/Backend connections:** none.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** This is the **unmodified `create-next-app` starter page** — the default Next.js/Vercel template content ("To get started, edit the page.tsx file", links to Vercel templates/docs, Deploy/Documentation buttons, `next.svg`/`vercel.svg` logos).
- **Non-Coder:** This is the generic "Welcome to Next.js" placeholder page that ships with every new Next.js project — it was never replaced with real dashboard content.

### Section 3: Structure
1. Renders the stock template markup only — no props, no state, no handlers.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none functionally, but see dead-code note: this page is effectively **unreachable** in normal use. `middleware.ts`'s `config.matcher` matches `/` (it only excludes `/api`, `/_next/static`, `/_next/image`, `favicon.ico`, `sitemap.xml`, `robots.txt`), and `middleware()`'s first branch unconditionally redirects `pathname === '/'` to `/agent/login` *before* any of the login/static bypass checks. So this component only ever renders if middleware itself fails to run (e.g., an edge-runtime failure) — it is not part of any real user flow.

**🗑️ Unused / Dead Code**
- **The entire file is dead/placeholder code.** Real content was never built for `/`, and it's provably unreachable given the middleware redirect. Along with the still-present `public/next.svg`, `public/vercel.svg` boilerplate assets, this indicates the route was never cleaned up after scaffolding.
- Outbound links to `vercel.com`/`nextjs.org` marketing/docs pages are shipped in a production admin tool — harmless but signals this page was never reviewed as production-facing.

**⚔️ Functionality Conflicts** — none (the redirect firmly wins).

**🔗 Mobile App & Database Misalignment** — N/A, no backend surface.

---

**Group summary (Entry Points):** `middleware.ts` is the real gatekeeper — solid, cross-report-verified logic with one defense-in-depth gap (falsy-role fallthrough on `/superadmin`, File 1) and a fail-open env-var edge case. `layout.tsx` is inert shared chrome. `page.tsx` is confirmed dead scaffold code, unreachable due to the middleware's unconditional `/` redirect, carrying no functional/security risk today.

---

## Group: `src/app/superadmin/*`

<a id="file-4"></a>
## File 4 — `src/app/superadmin/layout.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `SuperAdminLayout` (default export), `pathname`, `isLoginPage`, `isDashboardActive`, `isLiveGameActive`, `isAgentsActive`, `handleSignOut`.
- **DB/Backend connections:** none directly. Calls `signOutAction()` from `@/app/actions/auth` (dynamic import) on sign-out, which calls `supabase.auth.signOut()` — full audit deferred to when `src/app/actions/` is reached.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Client component (`"use client"`) providing shell/chrome for every `/superadmin/*` page — desktop sidebar + mobile bottom nav + mobile header, driven by `usePathname()` for active-tab state. Login pages get a bare passthrough wrapper.
- **Non-Coder:** The picture-frame around every admin page — sidebar/menu on desktop, bottom tab bar on mobile, branding, theme toggle, sign-out button. Login page is exempt since there's no menu before you're logged in.

### Section 3: Structure
1. Login-page bypass (`pathname` ends with `/login`) → bare `{children}`, no chrome.
2. Active-tab booleans compare/prefix-match `pathname`.
3. `handleSignOut` — dynamic import of `signOutAction`, redirects to `/superadmin/login`.
4. Desktop sidebar (`hidden md:flex`) — brand + `ThemeToggle` + 3 nav links + sign-out.
5. Mobile header (`flex md:hidden`) — compact brand + theme toggle + icon-only sign-out.
6. Scrollable main content pane renders `{children}`.
7. Mobile bottom nav (`fixed`, floating glass pill) — duplicates the 3 nav links with animated active indicator.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- No client-side role/auth check here at all — fully trusts `middleware.ts`. Combined with the falsy-role fallthrough found in File 1, a user reaching this layout via that gap would see the full admin nav chrome rendered (though data actions still gate via `requireAuth()` server-side).
- `isLoginPage = pathname?.endsWith('/login')` matches by suffix, not exact route — fine today (only one `/login` route in this section) but fragile if a future route ends in `/login`.
- `handleSignOut` has no error handling — a `signOut()` network failure fails silently with no loading state or user feedback.

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts**
- Desktop sidebar and mobile bottom nav independently duplicate the same 3 links/active-state logic (shared booleans, but fully separate JSX) — no shared source of truth, so a new nav item risks being added to one and forgotten in the other.

**🔗 Mobile App & Database Misalignment** — N/A, pure navigation chrome, no RPC/table calls.

---

<a id="file-5"></a>
## File 5 — `src/app/superadmin/login/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `LoginForm` (inner client component), `SuperAdminLogin` (default export, wraps `LoginForm` in `React.Suspense`), state: `showPassword`, `isPending`.
- **DB/Backend connections:** none directly — submits via `<form action={superAdminLogin}>` to the server action in `./actions.ts` (File 6).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Client component rendering the SuperAdmin login form. Uses `useSearchParams()` to read an `?error=` query param (requires the `Suspense` wrapper, which is why the export is split into two components). Submits natively via the React 19/Next.js "form action" pattern (`action={superAdminLogin}`) rather than manual `fetch`/`onSubmit` POST.
- **Non-Coder:** The sign-in screen for the admin portal — username/password fields, a show/hide password toggle, and a "LOGIN" button that shows a spinner while checking your credentials, with any error message shown above the form.

### Section 3: Structure
1. `SuperAdminLogin` wraps `LoginForm` in `Suspense` (required because `useSearchParams` opts the subtree out of static rendering).
2. `LoginForm` reads `?error=` from the URL and renders it as an inline red banner if present.
3. `handleSubmit` sets `isPending = true` on any submit attempt (the browser blocks submission first if `required` fields are empty, so this only fires on an actual attempt).
4. Password visibility toggle (`showPassword`) swaps the `<Input type>` between `text`/`password`.
5. Submit button disables and shows a spinner + "SIGNING IN..." while `isPending`.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **`isPending` is never reset to `false`.** On a failed login, `superAdminLogin` (File 6) calls `redirect('/superadmin/login?error=...')` — a same-route navigation (only the query string changes), so this component instance is not remounted and its local state survives. There is no `useEffect`/callback that clears `isPending` after the action settles. Net effect: after any failed login attempt, the submit button is left permanently disabled showing "SIGNING IN..." with no way to retry without a manual page refresh.

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts** — none within this file.

**🔗 Mobile App & Database Misalignment** — N/A, no direct backend calls (handled by File 6).

---

<a id="file-6"></a>
## File 6 — `src/app/superadmin/login/actions.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `superAdminLogin(formData: FormData)` (server action, default flow target of File 5's form).
- **Database & Backend Connections:** `supabase.auth.signInWithPassword({ email, password })` (RLS-scoped client from `lib/supabase.ts` `createClient()`); a **separately constructed** service-role client (`@supabase/supabase-js` `createClient`, inline, using `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL`) querying `profiles.role` and `profiles.is_active` via `.eq('id', data.user.id).single()`.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Two-stage login: (1) Supabase Auth password check via the anon/RLS client, (2) a second, service-role lookup of the caller's own `profiles` row to authoritatively check `is_active` and `role === 'superadmin'`, since — per the in-file comment — an earlier version trusted a nonexistent `profiles.status` column and silently fell back to client-writable metadata (documented as fix **S-1**). Every failure path explicitly signs the just-created session back out before redirecting, so no session is left dangling for a rejected login.
- **Non-Coder:** Checks your password first, then does a second, tamper-proof check ("are you actually an active superadmin in our records?") before letting you in — and if either check fails, it makes sure you're fully logged back out rather than left in limbo.

### Section 3: Structure
1. Read/trim `username`/`password` from `FormData`; redirect with an error if either is empty.
2. Derive `email` from username via the `@bestsmartgame.com` convention (matches the DB's CHECK constraint per `DATABASE_AUDIT_REPORT.md`).
3. `signInWithPassword` — wrong credentials → sign out (no-op, nothing to sign out yet) and redirect with a generic "Invalid username or password" error.
4. Env guard for service-role credentials — missing → sign out and redirect with "Server configuration error."
5. Build an ad-hoc service-role client inline and fetch `role, is_active` for `data.user.id`.
6. **Fail closed, no fallback:** missing/errored profile row → sign out, "Account could not be verified."
7. `!profile.is_active` → sign out, "This account is suspended."
8. `profile.role !== 'superadmin'` → sign out, "Unauthorized. Only SuperAdmin accounts can sign in here."
9. All checks pass → `redirect('/superadmin')`.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Account-status oracle via differentiated error messages.** Steps 3/6/7/8 return four *distinct* error strings, and steps 6-8 are only reachable once `signInWithPassword` has already succeeded — i.e., once the password is confirmed correct. An attacker who has (or is guessing) a valid agent/player credential pair can submit it to this superadmin-only form and, from the specific error text alone, learn: "this password is correct, and the account is suspended" (step 7) vs. "this password is correct, but it's not a superadmin account" (step 8) vs. "credentials didn't even match" (step 3). That leaks account existence/state/role for any account in the system through a form that's supposed to be superadmin-only, and is exactly the kind of oracle a generic "Invalid credentials" message is meant to prevent. Every branch already does the right thing operationally (fail closed, force sign-out) — this is purely an information-disclosure issue in the messaging, not an access-control bypass.
- Minor: comparing to File 5's bug, a rejected login here always redirects (full navigation-with-new-search-params), so the server side has no "pending" concept — the stuck-spinner bug is purely client-side state, not caused by this file.

**🗑️ Unused / Dead Code / Duplication**
- This file builds its own inline service-role client (`createSupabaseClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })`) instead of reusing `createAdminClient()` already exported from `src/lib/supabase.ts`, which does the exact same thing but is typed with the generated `<Database>` schema and centralizes the "credentials not configured" handling (throws there vs. redirects here). Two independent implementations of the same primitive risk drifting apart (e.g., if the admin-client options ever change, this inline copy won't follow) and this call site loses compile-time column/table name checking that `createAdminClient()`'s typing would otherwise provide on the `.from('profiles').select('role, is_active')` call.

**⚔️ Functionality Conflicts** — none beyond the duplication above.

**🔗 Mobile App & Database Misalignment**
- **Confirmed consistent** with `DATABASE_AUDIT_REPORT.md`: `profiles` has `role` (CHECK `player`/`agent`/`superadmin`) and `is_active` — no `status` column — matching this file's own S-1-fix comment and its `role`/`is_active` column selection exactly. The `@bestsmartgame.com` email-derivation convention also matches the DB report's noted CHECK-constraint-enforced design (File 4 of the DB audit).
- No mobile-app surface to cross-check (this is a superadmin-only, web-only flow).

---

<a id="file-7"></a>
## File 7 — `src/app/superadmin/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `SuperAdminDashboard` (default export). Imports `getRtpAction`, `updateRtpAction`, `getAuditLogsAction`, `getSystemOverviewMetricsAction`, `getLatestGameDrawsAction` from `./actions`. ~20 `useState` hooks, `fetchMetrics`, `handleManualRefresh`, `handleApplyRtp`, `filteredLogs`/`paginatedLogs` (`useMemo`).
- **Database & Backend Connections:** none directly — all reached indirectly through the four server actions actually called (`getSystemOverviewMetricsAction`, `getRtpAction`, `getAuditLogsAction`, `updateRtpAction`); `getLatestGameDrawsAction` is imported but never invoked (see below).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Client component (`"use client"`) for the SuperAdmin home/overview page — KPI cards, a gameplay/bets audit widget with a Today/Lifetime toggle, an RTP configuration panel (slider + presets), and a searchable/paginated/filterable system audit log. Polls metrics every 60s and re-renders a countdown label every 1s.
- **Non-Coder:** The admin's main "cockpit" screen — top-line numbers (coins issued today, active agents/players, current payout rate), a bet-volume summary, a slider to change the game's payout percentage, and a live-updating list of recent system events.

### Section 3: Structure (Step-by-Step)
1. **`fetchMetrics`** — fires `getSystemOverviewMetricsAction`, `getRtpAction`, `getAuditLogsAction` in parallel via `Promise.all`, populates ~12 metric states plus `rtpValue`/`systemLogs`.
2. **Auto-poll effect** — runs `fetchMetrics(true)` on mount, then every 60s via `setInterval`, alongside a separate 1s `setInterval` driving a 60→1 countdown label.
3. **`nowTime` ticker effect** — a second, independent 1s `setInterval` updating `nowTime`.
4. **`handleManualRefresh`** — re-fetches metrics, shows a spinner for a fixed 500ms.
5. **`handleApplyRtp`** — calls `updateRtpAction`, updates local `rtpValue`/success banner on `res.success`.
6. **Gameplay & Bets Audit widget** — Today/Lifetime toggle switches which pre-fetched metric set (`today*` vs `total*`) is displayed; 4 metrics (bets placed, coins bet, coins won, net house P/L).
7. **RTP Configuration card** — slider (50-100%, step 0.5), 6 quick-preset buttons, a derived "Yield Rating" badge and player-return/house-edge progress bar, "Apply Configuration" button.
8. **Recent System Logs widget** — category filter pills (ALL/System/Transaction/Security), text search, client-side pagination (`ResponsivePagination`, 4/page) over the 50 most recent logs already fetched.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Server-action errors are fetched but never surfaced.** All four actions return `{ ..., error: string | null }` on failure (confirmed by reading `./actions.ts`, File 8 below) — `getSystemOverviewMetricsAction` returns `{ ...EMPTY_METRICS, error: 'Could not load metrics: ...' }` on any query failure, `getRtpAction`/`getAuditLogsAction` similarly. `fetchMetrics` here only checks truthiness (`if (resMetrics)`, `if (resRtp?.rtp)`, `if (resLogs?.logs)`) and **never reads or displays `.error`**. A real backend failure (RLS error, network hiccup, dropped column) renders as all-zero KPI cards and an empty log list — visually identical to "the platform genuinely had zero activity" — with no error banner telling the admin the load actually failed. For a financial control panel, that's a meaningful gap: a silent data-load failure looks like good news.
- **`updateRtpAction` failures are silently swallowed.** `handleApplyRtp` only branches on `res.success` to update state/show the success toast; when `res.success` is `false` (e.g. a DB error), nothing happens at all — no error message, the slider just stops showing "Saving Configuration..." with zero indication the payout-rate change was not actually persisted. Since RTP directly controls house edge, an admin could reasonably believe a rate change took effect when it silently didn't.
- **Dead ticker driving a wasted re-render every second.** The `nowTime` state (line 47, updated via `setInterval(() => setNowTime(Date.now()), 1000)`, lines 63-68) is set but never read anywhere in the render output — it forces a full re-render of this fairly heavy dashboard component once per second for no visible effect. Combined with the already-running 1s countdown interval, that's two independent 1-second timers on this page, one of which does nothing.
- **`getLatestGameDrawsAction` is imported but never called**, and its corresponding state (`latestDraws`/`setLatestDraws`, `selectedGameTab`/`setSelectedGameTab`) is never rendered anywhere in the JSX. This looks like a "Live Draw Monitor & Multi-Game" section (per the state's own inline comment) that was scaffolded and then abandoned or moved — worth checking against `src/app/superadmin/live-game/page.tsx` when that file is audited, to see whether the feature actually lives there instead.
- **Unbounded full-table scans on a page that auto-polls every 60s.** `getSystemOverviewMetricsAction` (File 8) pulls the entire `profiles` and `bets` tables (`.range(0, 999999)`) and aggregates in JS rather than doing the aggregation in SQL/RPC. Functionally correct today, but this is an O(row-count) fetch-and-sum repeated automatically every 60 seconds for as long as this page is open — a scalability concern as `profiles`/`bets` grow.

**🗑️ Unused / Dead Code**
- `getLatestGameDrawsAction` import, `latestDraws`, `selectedGameTab`, `nowTime` and their setters — all dead (see above).

**⚔️ Functionality Conflicts** — none within this file beyond the dead-state items above.

**🔗 Mobile App & Database Misalignment**
- **Confirmed correct:** `game_config.rtp_percentage` (id=`'global'`) — table/column names match `DATABASE_AUDIT_REPORT.md`'s v2 schema exactly (`game_config` replaces `agent_configs`).
- **Confirmed correct:** `bets.total_stake`/`total_payout` column names match the DB report's v2 schema.
- **Real, DB-audit-predicted bug realized here:** the DB report (Executive Summary #6, MEDIUM) already flags that `coin_ledger` rows with `kind IN ('admin_credit','admin_debit')` are written for **two semantically different events** — an agent's own balance side-effect from `agent_transfer_coins` (an internal transfer, not new money) vs. `admin_issue_coins` genuinely injecting/withdrawing money at the top of the hierarchy — and warns that "any report filtering `coin_ledger WHERE kind IN ('admin_credit','admin_debit')` cannot distinguish these two." `getSystemOverviewMetricsAction`'s `net_issued_today` calculation (File 8) does **exactly that filter**, and its result is surfaced on this page as the "Today Issued" KPI card. This means the headline "Today Issued" number on the admin's front page conflates real coin issuance with unrelated agent-to-player transfer bookkeeping — the DB audit's predicted risk is a live, displayed metric here, not just a theoretical schema concern.

---

<a id="file-8"></a>
## File 8 — `src/app/superadmin/actions.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `logAuditEventAction`, `getAuditLogsAction`, `getSystemOverviewMetricsAction` (+ `SystemMetrics` type, `EMPTY_METRICS`), `getRtpAction`, `updateRtpAction`, `getLatestGameDrawsAction` (+ `DrawRow` type); helpers `istDayStartISO`, `istTime`.
- **Database & Backend Connections:** `audit_log` (insert, select `id, kind, detail, created_at, actor_id`), `profiles` (select `role, coin_balance, is_active`; select `id, username` for actor-name resolution), `coin_ledger` (select `amount`, filtered by `kind IN ('admin_credit','admin_debit')` and `created_at`), `bets` (select `total_stake, total_payout`), `game_config` (select/update `rtp_percentage` where `id = 'global'`), `rounds` (select `id, round_number, red, green, black, total_stake, total_payout, scheduled_at, drawn_at`, embedded `bets(total_stake, total_payout, profiles:user_id(username))`), RPC `get_current_round()`. All queries run through `createAdminClient()` (service-role), gated by `requireAuth(['superadmin'])` on every export.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Server-action module (`'use server'`) backing the SuperAdmin dashboard home. Every export starts with `requireAuth(['superadmin'])` and fails closed on error. Uses the service-role client to bypass RLS for admin-wide aggregation, deliberately avoids PostgREST relationship embeds in `getAuditLogsAction` (second query for actor names instead) citing a documented prior bug class, computes "today" boundaries in IST, and carries inline changelog comments (`B-2`, `B-3`, `M-7`) documenting specific historical bugs this version fixes.
- **Non-Coder:** The backend logic for the admin's cockpit screen — pulls together how many coins exist, how many agents/players are active, how much was wagered/won today vs. ever, reads and updates the global payout percentage, and fetches the admin activity log, all while double-checking the requester is actually a superadmin before touching anything.

### Section 3: Structure
1. **IST helpers** — `istDayStartISO()` (midnight IST as ISO string, for "today" filters), `istTime()` (display formatting).
2. **`logAuditEventAction`** — best-effort insert into `audit_log`; swallows its own errors by design ("audit logging must never break the operation it is recording").
3. **`getAuditLogsAction`** — last 50 `audit_log` rows, resolves `actor_id → username` via a second batched query (not an embed), maps to display shape with IST time.
4. **`getSystemOverviewMetricsAction`** — 4 parallel full-table-ish reads (`profiles`, today's `coin_ledger`, all `bets`, today's `bets`), aggregates coin totals / active-agent/player counts (`is_active` gated — the `B-2` fix) / net issuance (credit − debit — the `B-3` fix) / lifetime & today bet/stake/payout/house sums, all in JS.
5. **`getRtpAction`** / **`updateRtpAction`** — read/write `game_config.rtp_percentage`; write path re-validates the 50-100 range (defense-in-depth alongside the DB's own CHECK), logs an audit event, and calls `revalidatePath('/superadmin')` on success.
6. **`getLatestGameDrawsAction`** — last 20 drawn rounds with per-bet detail via a PostgREST embed, plus live "current round" telemetry via `get_current_round()` RPC (digits only exposed once betting closes, per its own comment).

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Ledger `kind` conflation reaches this file's output directly** (see File 7's cross-check above) — `net_issued_today` sums `admin_credit`/`admin_debit` ledger rows without any way to exclude `agent_transfer_coins`-originated rows, which the DB audit already identified as impossible to distinguish from genuine `admin_issue_coins` rows using only the `kind` column. This function is the concrete point where that ambiguity becomes an inaccurate business metric.
- **Self-contradictory embed usage.** `getAuditLogsAction`'s own comment explains *why* it avoids a PostgREST embed for actor-name resolution: "Embeds silently drop rows when the relationship cannot be resolved — a failure mode this codebase has already been bitten by." `getLatestGameDrawsAction`, in the same file, does the exact opposite — `bets ( total_stake, total_payout, profiles:user_id ( username ) )` — for the same kind of foreign-key-to-username resolution. If a bet's `profiles` relationship fails to resolve for any reason, that row could silently vanish from `player_bets`, understating a round's displayed `total_stake`/`total_payout`/`player_count` in the (currently unused, per File 7) Live Draw Monitor. Low real-world impact today since this function isn't called from the audited page, but it's the same bug class the file explicitly warns about elsewhere, reintroduced a few dozen lines later.
- **No pagination/row cap on full-table aggregation** — `.range(0, 999999)` is a documented workaround for PostgREST's 1,000-row default, but it's still an unbounded read of `profiles` and `bets` in their entirety, done in JS rather than pushed down to SQL (`COUNT`/`SUM`). Will degrade linearly with table growth; called every 60s per open dashboard tab (per File 7).

**🗑️ Unused / Dead Code**
- `getLatestGameDrawsAction` and its `DrawRow` type are fully implemented but have no live caller in the codebase found so far (File 7 imports but never invokes it) — carrying it forward to check against `live-game/page.tsx` next.

**⚔️ Functionality Conflicts**
- The embed-vs-no-embed inconsistency above is a direct self-conflict within this one file's stated design philosophy.

**🔗 Mobile App & Database Misalignment**
- **Confirmed correct against `DATABASE_AUDIT_REPORT.md`:** all table/column names used here (`audit_log.kind/detail/actor_id`, `profiles.role/coin_balance/is_active`, `coin_ledger.amount/kind`, `bets.total_stake/total_payout`, `game_config.rtp_percentage`, `rounds.red/green/black/total_stake/total_payout`) match the documented v2 schema exactly — no naming drift found in this file.
- **Confirmed correct:** the comment "`get_current_round()` only reveals digits once the betting window has closed" matches the DB report's own description of that function's behavior (File 6/9 of the DB audit) — the admin live-telemetry code cannot leak an outcome early, consistent with the round-integrity fixes documented there.
- **Positive audit-trail confirmation:** the DB report already anticipated and validated this exact file's `audit_log` write pattern ("writes via `createAdminClient()`... legitimate, trusted server-side bypass, consistent with the stated model" — DB audit File 5) — no discrepancy.

---

<a id="file-9"></a>
## File 9 — `src/app/superadmin/agents/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `AgentsPage` (default export). Imports `createAgentAction`, `getAgentsAction` from `./actions`. State: `agents`, `isLoadingAgents`, `isRefreshing`, `countdown`, `currentPage`, `searchQuery`, `statusFilter`, create-modal state (`isOpen`, `isLoading`, `errorMessage`, `successMessage`, `showPassword`, `usernameInput`), derived `isUsernameValid`, `filteredAgents`, `totalPages`, `paginatedAgents`, `activeCount`, `totalCirculation`.
- **DB/Backend connections:** none directly — via `getAgentsAction`/`createAgentAction` in File 10.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Client component listing all agents with search/status-filter/pagination, a responsive desktop-table/mobile-card dual layout, 60s auto-poll, and a "Create Agent" dialog with live username-format validation.
- **Non-Coder:** The admin's agent roster — see every agent, their coin balance and active/blocked status, search/filter them, and register a brand-new agent account through a popup form.

### Section 3: Structure
1. **`loadAgents`** — fetches via `getAgentsAction`, sets `agents` on any truthy `res.agents`.
2. **Auto-poll effect** — initial load + 60s interval, 1s countdown ticker.
3. **`handleCreateAgent`** — submits `createAgentAction`, shows inline error/success, closes dialog + reloads list after a 1.2s success delay.
4. **Client-side filtering** — `filteredAgents` by name/username substring + active/blocked status; paginated 10/page.
5. **Overview strip** — "Total Agents" count card, "Active Network" card (shows `formatCurrency(totalCirculation)` — the sum of all agents' coin balances).
6. **Desktop table / mobile cards** — duplicate renderings of the same agent list, each row linking to `/superadmin/agents/[username]`.
7. **Create Agent dialog** — name/username/password fields, live regex validation + checkmark/X indicator on username, submit disabled while invalid or loading.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Same silent-error pattern as File 7/8, worse here.** `getAgentsAction` returns `{ agents: [], error: string }` on failure — but `loadAgents`'s check is `if (res.agents)`. Since `res.agents` is **always an array**, even the empty-on-error case (`[]`) is truthy in JavaScript, so this condition is always true. Every backend failure silently clears the table to "No agents found matching current filter criteria" with zero indication anything went wrong — indistinguishable from a genuinely empty (or fully filtered-out) agent list.
- **Confirmed three-way validation mismatch on username format**, verified directly against the database migration (`supabase/migrations/20260807000000_rebuild_v2_schema.sql:102`, `CONSTRAINT profiles_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,20}$')`) and the server action (File 10, `createAgentAction`: `/^[A-Za-z0-9_]{3,20}$/`) — both explicitly **allow underscores**. This file's client-side check, `isUsernameValid = /^[a-zA-Z0-9]{3,20}$/.test(usernameInput)` (line 53), **does not** allow underscores, disables the submit button, and shows "No symbols allowed. Use 3-20 letters/numbers only" for a username the database and server would happily accept. A real, verifiable UX regression — legitimate `agent_01`-style usernames the rest of the stack supports can't be submitted through this form.
- **`activeCount` (line 127) is computed and never used anywhere.** The "Active Network" card it looks like it was meant for instead displays `totalCirculation` (a coin sum) under a `Coins` icon — leaving a functioning "how many agents are active" calculation sitting dead in the component while the card's own label ("Active Network") arguably better matches the unused `activeCount` than the money total it currently shows.

**🗑️ Unused / Dead Code**
- `activeCount` — see above.

**⚔️ Functionality Conflicts**
- Client/server/DB username-regex mismatch, detailed above.
- Desktop table and mobile card views are two full independent JSX implementations of the same agent row — same duplication pattern already flagged in `superadmin/layout.tsx` (File 4).

**🔗 Mobile App & Database Misalignment**
- N/A directly (no bsg_app surface for agent management); DB-level validation cross-check performed above.

---

<a id="file-10"></a>
## File 10 — `src/app/superadmin/agents/actions.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `resolveAgentId`, `getAgentsAction`, `getAgentDetailAction`, `createAgentAction`, `issueAgentCoinsAction`, `setAgentActiveAction`, `updateAgentPasswordAction`, `getAgentCoinLedgerAction` (+ `AgentRow` type). Imports `logAuditEventAction` from `../actions` (File 8), ledger helpers `isCredit`/`toWholeCoins` from `@/lib/ledger`.
- **Database & Backend Connections:** `profiles` (select/update `id, username, full_name, coin_balance, is_active, agent_id, created_at`), `active_sessions` (select `user_id, last_seen_at`; delete by `user_id`), `coin_ledger` (select `id, user_id, amount, balance_after, kind, created_at`, filtered `kind IN ('admin_credit','admin_debit')`), RPC `admin_issue_coins(p_agent_id, p_amount, p_direction)`, Supabase Auth Admin (`auth.admin.createUser`, `auth.admin.updateUserById`).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Full CRUD + moderation surface for agent accounts. Every export gates on `requireAuth(['superadmin'])`. Coin issuance deliberately routes through the RPC using the **caller's own session** (not the service-role client) so the database itself identifies and authorizes the actor via `auth.uid()`; the service-role client is reserved for reads and Supabase Auth admin operations already authorized by the `requireAuth` check above them.
- **Non-Coder:** The backend logic behind the agent roster page — list agents, drill into one agent's detail, create a new agent login, give/take coins, block or unblock an agent (and everyone under them), reset a forgotten password, and pull the coin-issuance ledger.

### Section 3: Structure
1. **`resolveAgentId`** — accepts either a UUID or a username (case-insensitive `ilike`), shared by nearly every other export.
2. **`getAgentsAction`** — all agents + a computed `player_count` per agent (second query over all players, counted in JS).
3. **`getAgentDetailAction`** — one agent + their players + online status derived from `active_sessions.last_seen_at` (< 60s = online).
4. **`createAgentAction`** — validates name/username-format/password-length, creates the Auth user via `auth.admin.createUser` with `user_metadata: { username, full_name, role: 'agent' }` (relies on the `handle_new_user` trigger, per the DB audit, to create the matching `profiles` row and mirror role into `app_metadata`), audit-logs, revalidates.
5. **`issueAgentCoinsAction`** — validates a whole positive coin amount, resolves the agent, calls `admin_issue_coins` RPC **with the caller's own session** (not admin client) so the DB enforces the superadmin check itself.
6. **`setAgentActiveAction`** — takes the desired boolean directly (documented `B-1` fix, avoiding a prior no-op bug from deriving new state off a passed "current" value); updates the agent's `is_active`, then cascades the same value to every player under that agent, then deletes `active_sessions` for the agent + all cascaded players if blocking; audit-logs.
7. **`updateAgentPasswordAction`** — `auth.admin.updateUserById` password reset, audit-logged.
8. **`getAgentCoinLedgerAction`** — paginated, filterable (agent/date-range/direction/free-text search) `coin_ledger` view with a filter-matching summary (credited/debited/net), resolving agent names via a second query rather than an embed (explicitly to avoid the same silent-row-drop failure mode flagged elsewhere).

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **`setAgentActiveAction`'s cascade is not atomic.** It performs up to four sequential, independent writes (update agent → read agent's players → bulk-update players → delete `active_sessions`), each with its own early-return-on-error. If the agent's own `is_active` update succeeds but any later step fails (e.g., the players bulk-update errors), the function returns an error — but the agent has *already* been flipped to blocked/unblocked while their players and/or active sessions were not updated to match. Given the in-file comment explicitly frames "cascades in BOTH directions" as the fix for a named prior bug (M-1: blocked agents not actually losing access), a failed cascade midway silently reproduces a version of that same inconsistent state (agent blocked, players and their live sessions untouched) rather than rolling back or retrying.
- **`getAgentCoinLedgerAction` inherits the ledger `kind`-conflation issue** already identified in File 7/8 and confirmed by `DATABASE_AUDIT_REPORT.md` (Executive Summary #6): it filters `coin_ledger WHERE kind IN ('admin_credit','admin_debit')`, which cannot distinguish a superadmin's genuine coin issuance from an agent's own balance side-effect of a player transfer (`agent_transfer_coins` writes the same two `kind` values). This function specifically powers the page's own "Coins Issued Ledger" link (File 9, line 320-326) — an audit trail whose entire purpose is tracking coin issuance is unable to separate real issuance from unrelated transfer bookkeeping. Carrying this forward to check `agents/issued/page.tsx` next, since that's presumably where this ledger is actually displayed.

**🗑️ Unused / Dead Code** — none found in this file.

**⚔️ Functionality Conflicts**
- None beyond the username-regex mismatch already noted against File 9.

**🔗 Mobile App & Database Misalignment**
- **Confirmed correct:** all table/column names (`profiles.coin_balance/is_active/agent_id/created_at`, `active_sessions.user_id/last_seen_at`, `coin_ledger.amount/balance_after/kind`) match `DATABASE_AUDIT_REPORT.md`'s v2 schema.
- **Confirmed correct, cross-verified against source:** `createAgentAction`'s username regex (`/^[A-Za-z0-9_]{3,20}$/`) is byte-for-byte identical to the live DB constraint `profiles_username_format` (`supabase/migrations/20260807000000_rebuild_v2_schema.sql:102`) — server and database agree; only the client page (File 9) diverges.
- **Confirmed correct and intentional (not a recurrence of the S-2 vulnerability):** `createAgentAction` sets `user_metadata: { role: 'agent' }` on `auth.admin.createUser` — this looks superficially like the self-service `user_metadata` role-escalation bug the DB audit's S-2 fix closed, but it is categorically different: this call is made by an already-verified superadmin via the **service-role** Auth Admin API to provision a **brand-new** account, not a self-service `updateUser` call by an arbitrary logged-in user on their own account. `handle_new_user()` (per the DB audit, File 7) reads this metadata only at account-creation time and mirrors the clamped result into `app_metadata` — the vulnerable path (self-promotion via `supabase.auth.updateUser`) remains closed.
- **Confirmed correct:** `issueAgentCoinsAction` routing coin movement through the caller's own session (not the admin client) so `admin_issue_coins` authorizes via live `auth.uid()` matches the DB audit's documented privilege model for that RPC exactly.

---

<a id="file-11"></a>
## File 11 — `src/app/superadmin/agents/[agentUsername]/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `AgentDetailPage` (default export, dynamic route `[agentUsername]`). Imports `getAgentDetailAction`, `issueAgentCoinsAction`, `setAgentActiveAction`, `updateAgentPasswordAction` from `../actions` (File 10) — plus, notably, `getPlayerDetailHistoryAction` from `@/app/agent/players/actions` and `getAgentProfitReportAction` from `@/app/agent/profit/actions`, reaching directly into the **agent portal's** action modules (not yet audited — flagged forward). ~25 state hooks + 4 refs (`resolvedAgentIdRef`, `selectedPlayerIdRef`, `filterDateRef`, `statsScopeRef`, `isInitialMountRef`).
- **DB/Backend connections:** none directly — all via the five imported server actions.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The single-agent drill-down page — agent header/status, deposit/withdraw/password-reset modals, a two-pane players-list + selected-player-history layout (Game Plays / Coins History / P&L Audit tabs), each with date/outcome/mode filtering and pagination. Uses `React.use(params)` (React 19 Suspense-based params unwrapping) and a ref-based pattern to keep a stable `loadAgentDetails` callback while avoiding stale closures over filter state.
- **Non-Coder:** The full profile page for one agent — their balance and status, buttons to give/take coins or reset their password, and a browsable history of every player under them: what they played, their coin transactions, and profit/loss per player.

### Section 3: Structure (Step-by-Step)
1. **`loadAgentDetails`** — parallel-fetches agent detail + players (`getAgentDetailAction`) and the agent's profit report (`getAgentProfitReportAction`); on response, syncs `resolvedAgentIdRef`, updates `players`, and re-selects the currently-selected player from the fresh list (auto-selecting the first player on initial load).
2. **Auto-poll** — initial full load (with history), then 90s silent re-fetch (balances/players/profit only, no history reload) + 1s countdown display.
3. **Deposit / Withdraw modals** — `handleTransferPoints` calls `issueAgentCoinsAction(resolvedAgentIdRef.current, amount, direction)`.
4. **Block/Unblock** — `handleToggleAgentStatus` calls `setAgentActiveAction` with the desired boolean (documented B-1 pattern).
5. **Password reset modal** — `handleUpdatePassword` calls `updateAgentPasswordAction`.
6. **Player selection** — `handleSelectPlayer` swaps the right-pane player, triggers `loadPlayerHistory` (fetches game plays + coin movements for that player).
7. **Performance stats** (`performanceStats` memo) — today/lifetime toggle over `gamePlays`, computing plays/bet volume/win payout/net GGR/margin, all client-side.
8. **Filtering** — date (quick "Today"/"Lifetime" + custom calendar picker), outcome (WON/LOST), and bet-mode (SINGLE/DOUBLE/TRIPLE) filters over the Games and Points tabs, each independently paginated (5/page).
9. **Games tab** — expandable per-spin breakdown of single/double/triple digit bets with win-highlighting based on the round's `red`/`green`/`black` digits.
10. **Points tab** — coin-movement ledger table (deposit/withdraw, amount, balance after).
11. **P&L tab** — per-player profit table sourced from `getAgentProfitReportAction`, plus a summary strip (today's P/L, lifetime P/L, total bets, house margin).

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Genuinely dead, self-contradicting branch (lines 219-220):**
  ```
  if (res.agent?.id) resolvedAgentIdRef.current = res.agent?.id
  else if (res.agent?.id) resolvedAgentIdRef.current = res.agent.id
  ```
  The `else if` re-tests the exact same condition the preceding `if` already tested and found false — it can never execute. Functionally harmless (the first branch already does the correct assignment) but it's a clear leftover/copy-paste artifact, not intentional logic.
- **Inconsistent fallback behavior for a missing `created_at_iso` timestamp, in two places in the same file.** `performanceStats` (lines 118-130) treats a game-play record with no `created_at_iso` as **always matching "today"** (`return true` in the missing-timestamp branch). `filteredGames`/`filteredPoints` (lines 142-179) instead fall back to comparing `spin.created_at` (a human-readable display string, not an ISO date) against an ISO `'YYYY-MM-DD'` filter string — which will essentially never match, so the same missing-timestamp record becomes **invisible** under any specific date filter instead of showing up. Two different, contradictory interpretations of the same edge case within one component: the summary card says "count it as today," the filtered table says "hide it from any dated view." Low likelihood of triggering (depends on whether `getPlayerDetailHistoryAction`, audited later, can ever omit `created_at_iso`), but a real inconsistency if it does.
- **Narrow initial-mount race on `resolvedAgentIdRef`.** It starts as `''`; if a user fires Deposit/Withdraw/Block/Password-reset before the first `loadAgentDetails` promise resolves, the action is called with an empty identifier. This fails safely — `resolveAgentId('')` (File 10) returns `null` for an empty/`'all'` identifier, so the action returns `{ error: 'Agent not found.' }` rather than corrupting data — but it's a user-visible false negative on a fast double-click before data loads.
- **Stale `selectedPlayer` on disappearance.** If an auto-poll refresh returns a `players` list that no longer contains the currently selected player (e.g., reassigned to a different agent), the code has no `else` branch for "selected player not found" — `selectedPlayer` state simply keeps its last value, so the right pane keeps showing a player who's no longer in the left-hand list.

**🗑️ Unused / Dead Code**
- The dead `else if` branch above.

**⚔️ Functionality Conflicts**
- The two contradictory missing-timestamp fallback behaviors noted above.
- Desktop-table vs. mobile-card duplication for the Games tab (same pattern flagged repeatedly elsewhere in this folder) — two independent JSX implementations of the same per-spin breakdown logic (win-highlighting math for single/double/triple picks is duplicated verbatim between the mobile and desktop branches).

**🔗 Mobile App & Database Misalignment**
- **Cross-folder coupling flagged forward, not yet verifiable:** this superadmin-portal file imports directly from `@/app/agent/players/actions` and `@/app/agent/profit/actions` — the *agent* portal's own action modules — rather than a shared/neutral location. Functionally this works (a superadmin viewing an agent's player history reuses the same data-fetching logic the agent portal itself uses), but it means this page's correctness depends on whatever `requireAuth([...])` role list those two actions use internally. If they're gated to `['agent']` only (rather than `['agent', 'superadmin']`), every call from this page would fail auth — need to confirm once `src/app/agent/players/actions.ts` and `src/app/agent/profit/actions.ts` are audited.
- The single/double/triple win-highlighting logic (`spin.black`, `spin.green`+`spin.black` concatenation, `spin.red`+`spin.green`+`spin.black`) matches the `rounds.red/green/black` column shape already confirmed against `DATABASE_AUDIT_REPORT.md` in File 8 — no naming drift.

---

<a id="file-12"></a>
## File 12 — `src/app/superadmin/agents/issued/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `CoinsIssuedPage` (default export). Imports `getAgentsAction`, `getAgentCoinLedgerAction` from `../actions` (File 10). State/refs mirror the filter-heavy pattern seen in File 11 (agent/type/date-preset/custom-date/search filters, each with a paired ref for the stable `loadData` callback).
- **DB/Backend connections:** none directly — via `getAgentsAction` (agent dropdown options) and `getAgentCoinLedgerAction` (the ledger table + summary).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The dedicated "Coins Issued Ledger" audit page — a filterable/paginated table of every `admin_credit`/`admin_debit` coin-ledger transaction, with agent/type/date-range/search filters, three summary KPI cards (Total Deposited, Total Withdrawn, Net Issued), and 60s auto-poll.
- **Non-Coder:** The money trail — every time the superadmin has given coins to or pulled coins back from an agent, listed as a searchable, filterable ledger, with running totals at the top.

### Section 3: Structure
1. **Agent dropdown** — loaded once via `getAgentsAction` on mount.
2. **`loadData`** — builds a date range from either the custom `filterDate` or a preset (`today`/`yesterday`/`7days`/`30days`/`all`), then calls `getAgentCoinLedgerAction` with agent/type/date/search/page filters.
3. **Filter-sync effect** — mirrors every filter state into a ref and re-fetches on change (skipping the initial mount, which the main effect below handles).
4. **Auto-poll** — initial load + 60s silent refresh + 1s countdown.
5. **Summary KPI cards** — `credited`/`debited`/`net` from the action's filter-aware summary.
6. **Desktop table / mobile cards** — duplicate renderings of the same transaction row, each linking to `/superadmin/agents/[username]`.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Custom date-picker filter is effectively broken — verified against the code.** Lines 80-82:
  ```js
  if (fp) {
    startDate = fp.toISOString()
    endDate = fp.toISOString()
  }
  ```
  Both bounds are set to the **exact same instant**. Compare this to the correctly-implemented `yesterday` preset three lines below (94-95), which explicitly builds separate start-of-day and end-of-day IST boundaries (`T00:00:00+05:30` / `T23:59:59.999+05:30`). Passed through to `getAgentCoinLedgerAction` (File 10), which applies `gte('created_at', startDate)` and `lte('created_at', endDate)` — a zero-width time window. Picking any specific day in the calendar popover will return transactions only if one happens to land on that literal millisecond, i.e. in practice **the custom date filter always returns an empty result set** on this compliance-critical ledger page, while the "Today"/"7D"/"30D" quick-pills work correctly.
- **The "Complete audit record" claim in this page's own subtitle is inaccurate**, for the same root cause traced through Files 7/8/10: `getAgentCoinLedgerAction` filters `coin_ledger WHERE kind IN ('admin_credit','admin_debit')`, which — per `DATABASE_AUDIT_REPORT.md`'s Executive Summary #6 — also includes ledger rows written by `agent_transfer_coins` (an agent's own balance moving as a side effect of paying a player), not just genuine superadmin-driven issuance/recall. This page is titled "Coins Issued Ledger" with the subtitle "Complete audit record of all coins issued and recalled by Super Admin to/from Agents" — that description is not accurate against the current schema/RPC design; the table can contain rows that were never a superadmin action at all. Of everywhere this root-cause issue surfaces in the codebase, this is the most direct instance, since compliance/audit accuracy is this page's sole purpose.
- **Same silent-error-swallowing pattern as every other file in this folder** (Files 7-11): `getAgentsAction()`'s `if (res.agents)` and `loadData`'s `if (res)` checks are both always-truthy (an object and a possibly-empty array are both truthy in JS), so a backend failure renders as an empty/zero-value ledger with no error message — consistent with the pattern already flagged repeatedly; not re-detailed here, see the folder summary.

**🗑️ Unused / Dead Code** — none found.

**⚔️ Functionality Conflicts**
- Desktop table / mobile card duplication (same recurring pattern as every other list view in this folder).

**🔗 Mobile App & Database Misalignment**
- Direct manifestation of the DB audit's ledger-`kind`-conflation finding — see above. No mobile-app surface (superadmin-only feature).

---

<a id="file-13"></a>
## File 13 — `src/app/superadmin/live-game/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `SuperAdminLiveGamePage` (default export). Imports `getLatestGameDrawsAction` from `../actions` (File 8) — **this is the live caller** that File 7/8 lacked; resolves the "dead code" question raised there.
- **DB/Backend connections:** none directly — entirely via `getLatestGameDrawsAction` (`rounds`+embedded `bets`/`profiles`, and `get_current_round()` RPC).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The real-time round-outcome monitor — a "God Mode" panel showing the in-progress round's live/pre-revealed winning digits once calculated, a "just completed" featured-result panel, a horizontal recent-draws chip stream, and a full searchable/filterable/paginated historical draw ledger with per-round player-bet drill-down. Polls every 5s.
- **Non-Coder:** The admin's "watch the game happen live" screen — shows the current round counting down, reveals the winning numbers as soon as they're calculated (even before the round visually finishes for players), and keeps a searchable history of every past round with who bet what.

### Section 3: Structure
1. **1s `nowTime` ticker** — drives all relative-time and countdown displays (unlike File 7's identical-looking but genuinely unused ticker, this one is actually read throughout the component).
2. **`loadDraws`** — fetches via `getLatestGameDrawsAction` every 5s + on manual refresh.
3. **Active-round panel** — if `activeRound` exists, shows either the "accumulating wagers" loading state or, once `activeRound.red/green/black` are non-null, the "God Mode Outcome Revealed" pre-result digits with a client-computed countdown.
4. **Just-completed panel** — falls back to showing the most recent settled draw with a relative-time badge when there's no active round data.
5. **Recent Draw Stream** — horizontal scrollable chips of the last up-to-10 draws with relative timestamps.
6. **Historical ledger table/cards** — search box, All/Won/Lost filter pills, expandable per-round player-bet breakdown, pagination (8/page).

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Round-ID fragment displayed as a player identity, verified against its own definition.** `hand_id` is defined in `getLatestGameDrawsAction` (File 8) as `` `...${String(r.id).slice(-8)}` `` — the last 8 characters of the **round's** UUID, not any player/user identifier. This file's featured-result panel renders it at line 371 as `@{latest.hand_id}` directly under a label reading `"Player:"` (line 370) — presenting a truncated round ID, `@`-prefixed like a username, as if it identifies the player who played. The same field is also the historical table's "Player" column header/content (desktop table `th`/`td`, lines 494/533). For any round with more than one bettor this is additionally misleading, since it implies a single player where there may be several (the correct multi-player breakdown only appears if the row is expanded).
- **Client-side countdown ignores the server-provided one and hardcodes stale-looking constants.** `getLatestGameDrawsAction` returns `activeRound.seconds_remaining`, `.seconds_into`, and `.draw_at_second` (defined in the `ActiveRound` interface, lines 42-53, and populated server-side from `get_current_round()`), but none of the three are ever read in this component. Instead, `roundCountdown` (lines 205-207) is computed entirely from the client's wall clock with hardcoded magic numbers:
  ```js
  const utcSecs = Math.floor(nowTime / 1000)
  const cycleRem = 103 - (utcSecs % 103)
  const roundCountdown = cycleRem >= 14 ? cycleRem - 13 : 0
  ```
  A 103-second cycle and a 13-second offset, guessed and hardcoded on the client, with no relationship to `game_config.draw_at_second` (confirmed by `DATABASE_AUDIT_REPORT.md` File 13 to have been retuned from 94 to 90 specifically to change the round timing) — any future change to that DB-configured value would silently desync this page's countdown from the actual round clock, while the correct, live, authoritative value is being fetched and discarded on every single poll.
- **Filter/search don't do what their own labels promise.** The status filter derives WON/LOST purely from `draw.total_payout` (`> 0` / `=== 0`, lines 113-116) instead of reusing the already-computed `draw.outcome` field (`'WON' | 'LOST' | 'NO BETS'`, set correctly in File 8) — so the "Lost" filter silently also includes rounds nobody bet on at all (`total_payout === 0` is trivially true for a `NO BETS` round too), conflating "players lost" with "no one played." Separately, the search box's placeholder reads "Search outcome or player..." but `matchesSearch` (lines 108-111) only checks `result`, `hand_id`, and `round_id` — never any `player_bets[].username` — so searching for an actual player's name returns nothing, despite the UI explicitly inviting it.

**🗑️ Unused / Dead Code**
- `activeRound.seconds_remaining`, `.seconds_into`, `.draw_at_second` — fetched, typed, never read (see countdown bug above).

**⚔️ Functionality Conflicts**
- **Resolves the File 7/8 "dead `getLatestGameDrawsAction`" question**, but sharpens it into a different finding: the action is very much alive and fully featured *here*. That means the identical-looking, unused `latestDraws`/`selectedGameTab`/`nowTime` state and dead import sitting in `superadmin/page.tsx` (File 7) isn't an in-progress feature — it's a stale, abandoned duplicate left behind after the real "Live Draw Monitor" was built as its own dedicated route here instead. Worth removing from File 7 rather than finishing it there.
- Desktop-table/mobile-card duplication, consistent with every other list view audited in this folder.

**🔗 Mobile App & Database Misalignment**
- **Worth a forward note, not a confirmed finding:** this page's own copy ("RTP Engine will analyze all bets and calculate the optimal winning combination at 20s remaining (Second 71)") frames digit-reveal as happening *while the round still shows time remaining*, which reads more alarmingly on its face than the underlying guarantee `DATABASE_AUDIT_REPORT.md` already verified (`get_current_round()` "only reveals digits once the betting window has closed... cannot leak an outcome even to an admin screen that is polling every 5 seconds," per that report's File 6/9 analysis and File 8's own dashboard-side comment). Taking the DB audit's already-verified RPC behavior as authoritative, this is self-consistent (betting closes at the same moment digits compute) rather than a new vulnerability — flagged only because the UI's own framing is easy to misread as "outcome known while betting is still possibly open," and it may be worth an explicit one-line confirmation in the code that betting truly cannot occur in that window.
- `rounds.red/green/black`, `total_stake`, `total_payout` naming — consistent with the DB audit's confirmed v2 schema (already verified in File 8).

---

## Folder-Level Completion Summary — `src/app/superadmin/`

### 1. Folder Architecture & Overview
This folder is the entire SuperAdmin ("God Mode") web console: a `layout.tsx` shell (sidebar/mobile-nav chrome, trusts `middleware.ts` for access control), a dedicated `login/` flow with its own defense-in-depth role/active check, a home dashboard (`page.tsx`+`actions.ts`) for system-wide KPIs/RTP config/audit log, an `agents/` sub-area (roster, per-agent detail/moderation, coins-issued ledger) that is by far the largest and most action-heavy part of the console, and a `live-game/` real-time round monitor. Every server action funnels through `requireAuth(['superadmin'])` (File 8/10, not yet independently audited — deferred to `lib/auth-guard.ts`) and uses `createAdminClient()` (service-role) for reads, with coin-moving RPCs specifically routed through the caller's own session so the database — not the application code — makes the final authorization call.

### 2. Folder-Wide Interdependencies
- `layout.tsx` (File 4) → `@/app/actions/auth` (outside this folder) for sign-out.
- `page.tsx`/`actions.ts` (Files 7-8) and `agents/*` (Files 9-12) both write to and read from `audit_log` via the shared `logAuditEventAction` (File 8), giving the folder one consistent audit trail.
- `agents/actions.ts`'s `resolveAgentId` (File 10) is the shared identifier-resolution helper used by nearly every agent-scoped action.
- `agents/[agentUsername]/page.tsx` (File 11) reaches **outside** this folder into `@/app/agent/players/actions` and `@/app/agent/profit/actions` — the only cross-portal coupling found in this folder, flagged for confirmation once `src/app/agent/` is audited.
- `live-game/page.tsx` (File 13) is the true home of the "Live Draw Monitor" feature that `page.tsx` (File 7) still carries dead scaffolding for.

### 3. Folder Bug & Conflict Summary
**Systemic, cross-cutting (found in 5+ files — Files 7, 9, 10, 12 and by extension 13's `getAgentsAction` reuse):** every list/metrics-fetching function in this folder returns `{ ..., error: string | null }` on failure, and **every single caller in this folder ignores it**, checking only the truthiness of the data field (`if (res.agents)`, `if (res)`, `if (resMetrics)`) — which is always true for an object or even an empty array. A real backend failure anywhere in this console renders as an empty table or all-zero KPIs, indistinguishable from genuinely-empty data, with no error banner anywhere in the folder. This is the single highest-value fix opportunity in the folder — one shared pattern, wrong in the same way every time.

**Financial/compliance-accuracy issue (Files 7, 8, 10, 12 — DB-audit-predicted, dashboard-confirmed):** `coin_ledger` rows tagged `admin_credit`/`admin_debit` conflate genuine superadmin coin issuance with an agent's own balance side-effect from unrelated player transfers. This inflates/distorts the "Today Issued" KPI (File 7/8) and directly undermines the stated purpose of the dedicated "Coins Issued Ledger" page (File 12), which explicitly claims to be a "Complete audit record ... issued and recalled by Super Admin."

**Concrete, verified functional bugs (not cross-cutting, one-off per file):**
- Stuck-spinner on failed superadmin login (File 5).
- Account-status oracle via differentiated superadmin-login error messages (File 6).
- Non-atomic block/unblock cascade that can leave an agent blocked but their players/sessions untouched on partial failure (File 10).
- Client/server/DB three-way username-regex mismatch blocking valid `agent_01`-style usernames (Files 9/10, cross-verified against the live migration SQL).
- Zero-width custom date-range filter on the Coins Issued Ledger, always returning empty results (File 12).
- Silently-failing RTP-update save with no error feedback (File 7/8).
- Round-ID fragment mislabeled and rendered as a player's `@username` (File 13).
- Client-side round countdown that ignores server-authoritative timing data in favor of hardcoded, drift-prone constants (File 13).
- Status/search filters on the live-game ledger that don't match their own labels — "Lost" includes unplayed rounds, "player" search doesn't search players (File 13).

**Dead code:**
- `src/app/page.tsx` is unreachable (outside this folder, File 3, noted for completeness).
- `getLatestGameDrawsAction`'s import + `latestDraws`/`selectedGameTab`/`nowTime` state in `page.tsx` (File 7) — confirmed genuinely dead now that File 13 shows the feature was built properly elsewhere.
- `activeCount` in `agents/page.tsx` (File 9).
- The self-contradicting `if/else if` on identical conditions in `agents/[agentUsername]/page.tsx` (File 11).
- `activeRound.seconds_remaining/.seconds_into/.draw_at_second` fetched and unused in `live-game/page.tsx` (File 13).

**Recurring, lower-severity pattern:** desktop-table vs. mobile-card view duplication appears in nearly every list/table in this folder (Files 4, 9, 11, 12, 13) — same data, two independently maintained JSX implementations each, with no shared row/card component.

**Positive, confirmed-correct findings** (no action needed, listed for completeness): `middleware.ts`'s `app_metadata` role source (File 1) and this folder's login/session logic are fully consistent with `DATABASE_AUDIT_REPORT.md`'s S-1/S-2 fixes; every table/column name referenced across all 10 files in this folder (`profiles`, `rounds`, `bets`, `coin_ledger`, `game_config`, `audit_log`, `active_sessions`) matches the documented v2 schema exactly, with zero naming drift found; coin-movement RPC calls correctly use the caller's own session rather than the service-role client, matching the documented privilege model.

Audit for folder `src/app/superadmin/` is complete! Please provide the next folder to audit.

---

## Group: `src/app/actions/`

<a id="file-14"></a>
## File 14 — `src/app/actions/auth.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `signOutAction(redirectTo: string = '/agent/login')`.
- **Database & Backend Connections:** `supabase.auth.signOut()` via the RLS-respecting cookie-bound client (`createClient()` from `@/lib/supabase`) — no table/RPC access, Auth-only.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The single shared sign-out server action for the entire dashboard. Ends the caller's Supabase Auth session (clearing the SSR cookie via the client's cookie adapter) and redirects to a caller-supplied path.
- **Non-Coder:** The one piece of code that actually logs someone out, used by both the agent and superadmin portals' "Sign Out" buttons.

### Section 3: Structure
1. Create the cookie-bound Supabase client.
2. `supabase.auth.signOut()`.
3. `redirect(redirectTo)`.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **No error handling around `signOut()`.** If the Auth call throws (e.g. a transient network failure), the exception propagates unhandled out of the server action instead of still redirecting the user to a login page — the user would see Next.js's generic server-action error boundary rather than landing back at login. Low severity (rare failure mode, and the session cookie may well be stale/invalid anyway at that point) but worth noting since every "Sign Out" button in the app funnels through this one function.
- **Default parameter (`redirectTo = '/agent/login'`) is never actually used** — confirmed by checking both call sites (`agent/layout.tsx:24`, `superadmin/layout.tsx:23`), each of which explicitly passes its own literal redirect target. Not a bug, just dead-in-practice defensive code — harmless, but worth knowing it isn't load-bearing.

**🗑️ Unused / Dead Code** — the unused default parameter value, as above (minor).

**⚔️ Functionality Conflicts** — none.

**🔗 Mobile App & Database Misalignment**
- N/A — pure Auth session teardown, no schema/RPC surface to cross-check. `bsg_app` has its own separate `session_logout` RPC-based sign-out (per `DATABASE_AUDIT_REPORT.md`), unrelated to this web-only Auth-cookie flow — no misalignment, just two intentionally different mechanisms for two different clients.
- **Confirmed, not a bug:** both call sites pass hardcoded literal strings only (never user/query-controlled input) as `redirectTo`, so there's no open-redirect risk despite `redirect()` taking a caller-supplied string.

---

## Folder-Level Completion Summary — `src/app/actions/`

### 1. Folder Architecture & Overview
This folder contains exactly one file: a single shared `signOutAction`, used by both portal layouts (`agent/layout.tsx`, `superadmin/layout.tsx`) as their common sign-out implementation. It's the smallest folder in the codebase by design — a deliberate single point of truth for ending a session, rather than each portal reimplementing `auth.signOut()` + redirect itself.

### 2. Folder-Wide Interdependencies
- Consumed via a dynamic `import()` inside an event handler in both `agent/layout.tsx` and `superadmin/layout.tsx` (the superadmin side already reviewed in File 4) — an unnecessary micro-optimization for a one-line function, harmless but worth noting as a minor stylistic inconsistency once `agent/layout.tsx` is audited for its mirrored version of the same pattern.
- Depends on `@/lib/supabase`'s `createClient()`, not yet directly audited.

### 3. Folder Bug & Conflict Summary
- Missing error handling around `signOut()` (File 14) — low severity, single shared code path so a fix here covers both portals at once.
- No security issues found: no open-redirect risk (all call sites pass literal strings), no missing-auth concern (signing out doesn't need authorization).
- No dead code beyond the practically-unused default parameter value.

This is the smallest and cleanest folder audited so far — no cross-system misalignment, no schema surface, one small correctness gap.

Audit for folder `src/app/actions/` is complete! Please provide the next folder to audit.

---

## Group: `src/app/agent/*`

<a id="file-15"></a>
## File 15 — `src/app/agent/layout.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `AgentLayout` (default export), `pathname`, `isLoginPage`, `isCashierActive`, `isPlayersActive`, `isProfitActive`, `isHistoryActive`, `handleSignOut`.
- **DB/Backend connections:** none directly — `handleSignOut` dynamically imports and calls `signOutAction('/agent/login')` from `@/app/actions/auth` (File 14, already audited).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Structurally the agent-portal twin of `superadmin/layout.tsx` (File 4) — same "bare passthrough on `/login`, sidebar+mobile-nav chrome otherwise" pattern, same `usePathname()`-driven active-tab logic, same dynamic-import sign-out call, same desktop-sidebar/mobile-bottom-nav duplication. Four nav destinations instead of three: Cashier (`/agent`), Players, P&L Report, History.
- **Non-Coder:** The agent portal's equivalent of the superadmin's picture-frame — sidebar/bottom-nav, branding ("Back Office / Agent Portal"), theme toggle, sign-out — wrapping the agent's cashier, player list, profit report, and history pages.

### Section 3: Structure
Identical shape to File 4: login-page bypass → active-tab booleans (4, one per nav item) → `handleSignOut` → desktop sidebar → mobile header → scrollable main content → mobile bottom nav (4 links, duplicating the sidebar).

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases — identical class of issues already found in the superadmin twin (File 4), reproduced here:**
- No client-side role/auth check — fully trusts `middleware.ts`. Cross-referencing File 1's finding: the `/agent` guard in `middleware.ts` only explicitly bounces `'superadmin'` and `'player'` roles back out; unlike the `/superadmin` guard, it has **no separate falsy-role branch to worry about** here since `middleware.ts`'s `/agent` block doesn't have the same `if (userRole && ...)` truthy-gated structure — it checks `userRole === 'superadmin'` and `userRole === 'player'` explicitly and falls through (allow) for anything else, including a falsy/missing role. So a logged-in user with **no role claim at all** would also pass through into the agent portal here, same defense-in-depth gap as File 1, now confirmed to affect both portals symmetrically.
- `isLoginPage = pathname?.endsWith('/login')` — same suffix-match fragility as File 4.
- `handleSignOut` has no error handling — same as File 4.

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts**
- Desktop sidebar / mobile bottom nav duplication (same pattern as File 4, now confirmed in both portals — 4 nav links times two independent implementations, no shared component).
- **Confirms and sharpens a File 1 finding:** re-reading `middleware.ts`'s `/agent` guard (lines 82-93) alongside this file makes the falsy-role gap concrete for the agent portal too — not just `/superadmin`. Both portal guards admit a logged-in user with no synced role claim by default-allowing rather than default-denying.

**🔗 Mobile App & Database Misalignment** — N/A, pure navigation chrome.

---

<a id="file-16"></a>
## File 16 — `src/app/agent/login/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `LoginForm`, `AgentLogin` (default export). Structurally byte-for-byte the same component as `superadmin/login/page.tsx` (File 5) — different color theme (emerald/teal vs. amber) and copy ("Agent Back Office" vs. "Super Admin God Mode") only.
- **DB/Backend connections:** none directly — submits to `agentLogin` (File 17).

### Section 2 & 3 — Technical Overview / Structure
Identical to File 5: `Suspense`-wrapped form reading `?error=`, `isPending` state set on submit, password show/hide toggle, server-action form submission.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Same stuck-spinner bug as File 5, confirmed by identical code.** `isPending` is set `true` on submit and never reset; a failed login redirects to the same route (`/agent/login?error=...`), so the component instance survives and the submit button stays disabled on "SIGNING IN..." indefinitely after any failed attempt.

**🗑️ Unused / Dead Code** — none new.

**⚔️ Functionality Conflicts** — none within this file.

**🔗 Mobile App & Database Misalignment** — N/A, handled in File 17.

---

<a id="file-17"></a>
## File 17 — `src/app/agent/login/actions.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `agentLogin(formData: FormData)`.
- **Database & Backend Connections:** same two-client pattern as `superadmin/login/actions.ts` (File 6) — `signInWithPassword` via the RLS client, then an inline service-role client querying `profiles.role, is_active`.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The agent-portal counterpart to File 6, explicitly cross-referencing the same documented `S-1` defect (a query against a nonexistent `profiles.status` column that silently disabled the suspension check). Same password-then-profile-verification flow, same force-sign-out-on-any-failure discipline — but with **three separate role branches** instead of File 6's single `role !== 'superadmin'` check: explicit handling for `'superadmin'`, `'player'`, and a final catch-all `!== 'agent'`.
- **Non-Coder:** The agent-portal sign-in check — same two-step "password, then verify you're really an active agent" logic as the superadmin login, just pointed at agent accounts instead.

### Section 3: Structure
Same 9-step shape as File 6, except step 7-9 are three role checks instead of one: `role === 'superadmin'` → redirect to use `/superadmin/login` instead; `role === 'player'` → redirect to use the game app instead; `role !== 'agent'` → generic "Unauthorized account role."

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Sharper version of File 6's account-status oracle.** Where the superadmin login only reveals "this isn't a superadmin account," this one explicitly names the actual role back to the caller: "SuperAdmin accounts must sign in at /superadmin/login" vs. "Player accounts must sign in through the game app" vs. "This account is suspended" vs. a generic invalid-credentials message for a wrong password. Since all of these branches are only reachable after `signInWithPassword` has already confirmed the password is correct, anyone testing a known or guessed credential pair against this one form can learn not just "valid or not" but the **exact role** (superadmin/player/agent) and active-status of that account — a more precise version of the same information-disclosure class already flagged in File 6. As before, every branch is still access-control-safe (fails closed, forces sign-out) — this is a disclosure issue, not a bypass.
- **Unreachable final branch, verified against the DB schema.** `if (profile.role !== 'agent')` (line 72) is only reached after the preceding two `if`s have already excluded `'superadmin'` and `'player'`. `DATABASE_AUDIT_REPORT.md` confirms `profiles.role` is DB-constrained to exactly `{player, agent, superadmin}` (CHECK constraint) — so by the time execution reaches line 72, `profile.role` can only be `'agent'`, making `profile.role !== 'agent'` always false. This branch (and its "Unauthorized account role." message) is dead code that can never execute under the current schema.

**🗑️ Unused / Dead Code**
- The unreachable `role !== 'agent'` branch, as above.

**⚔️ Functionality Conflicts**
- **Same duplication as File 6:** hand-builds its own service-role client instead of reusing `createAdminClient()` from `lib/supabase.ts`.

**🔗 Mobile App & Database Misalignment**
- **Confirmed correct:** `profiles.role`/`is_active` usage and the `@bestsmartgame.com` email convention match the DB schema exactly, same as File 6.
- **Confirmed correct, consistent design:** the "Player accounts must sign in through the game app" message correctly reflects that `bsg_app` player sessions go through the entirely separate `session_login` RPC flow (per `DATABASE_AUDIT_REPORT.md` and `bsg_app/AUDIT_REPORT.md`), not this web-cookie-based Auth flow — no misalignment, just confirms the three-way routing (player→app, agent→this login, superadmin→File 6) is coherent by design, even though the messaging leaks more than ideal.

---

<a id="file-18"></a>
## File 18 — `src/app/agent/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `AgentDashboard` (default export). Imports `getPlayersAction`, `transferPlayerCoinsAction` from `./players/actions` (not yet audited), `getAgentDashboardDataAction` from `./actions` (File 19).
- **DB/Backend connections:** none directly — via the three imported actions.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The agent's "Cashier" home page — balance/player-count/today's-P&L KPI cards, a Quick Transfer widget (deposit/withdraw to any of the agent's players), and a searchable/filterable/paginated recent-transfers feed. 60s auto-poll.
- **Non-Coder:** The agent's front desk — see your coin balance and today's numbers, instantly send or pull coins from any of your players, and check your recent transfer activity.

### Section 3: Structure
1. **`fetchDashboardData`** — via `getAgentDashboardDataAction`, populates balance/today's stats/agent info/players/recent transactions.
2. **Auto-poll** — initial load + 60s silent refresh + 1s countdown.
3. **Quick Transfer widget** — player dropdown, amount field with +100/+500/+1000/+5000 preset-add buttons, deposit/withdraw buttons calling `transferPlayerCoinsAction`.
4. **Recent Coin Transfers widget** — search-by-name + type filter, desktop table / mobile cards, paginated (5/page), links to `/agent/history` for the full list.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Case-sensitivity typo defeats the "hide SuperAdmin username line" logic, confirmed in two separate places.** `getAgentDashboardDataAction` (File 19) sets `target_name: 'SuperAdmin'` (capital S **and** capital A) for ledger rows it can't attribute to a specific player. This file checks against `'Superadmin'` (capital S, lowercase everything else) in two places:
  - Desktop table (line 454): `txn.target_name !== 'Superadmin' && txn.target_username && (...)` — since the strings never match, this condition is always `true`, so the secondary username line always renders, including for actual SuperAdmin-attributed rows (redundantly showing "SuperAdmin" twice).
  - Mobile card (line 505): `txn.target_name === 'Superadmin' ? 'Superadmin' : \`@${txn.target_name...}\`` — since the strings never match, this always takes the `else` branch, so a genuine SuperAdmin-attributed transfer renders as `@SuperAdmin` on mobile — an incorrect `@`-prefixed "username" for an entity that has no username.
- **Silent-error-swallowing pattern, now confirmed in the agent portal too.** `fetchDashboardData`'s `if (resDash)` check is always true (the action always returns an object, even `EMPTY` with `error` set) — a backend failure renders as all-zero KPIs with no error banner, the same pattern already flagged repeatedly across the superadmin folder.

**🗑️ Unused / Dead Code** — none found in this file.

**⚔️ Functionality Conflicts** — none within this file (see File 19 for the ledger double-counting bug this page's "Recent Coin Transfers" widget inherits).

**🔗 Mobile App & Database Misalignment** — handled in File 19, where the underlying ledger query lives.

---

<a id="file-19"></a>
## File 19 — `src/app/agent/actions.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `getAgentDashboardDataAction`, `getAgentTransactionHistoryAction` (+ `AgentDashboardData`, `AgentTransferHistory` types), helpers `istDayStartISO`, `istDateTime`.
- **Database & Backend Connections:** `profiles` (own row + `.eq('agent_id', me.id)` for players), `bets` (`total_stake, total_payout` for the agent's players, today only), `coin_ledger` (`id, user_id, counterparty_id, kind, amount[, balance_after], created_at`, filtered by `CASHIER_KINDS` from `lib/ledger.ts` and `user_id IN [me.id, ...playerIds]`). Both exports gate on `requireAuth(['agent', 'superadmin'])`.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The agent-portal data layer for the cashier dashboard and (per its types) the full transaction-history page. Documents two named historical bugs it fixes (`S-4`: a filter referencing a nonexistent `parent_agent_id` column that silently zeroed every balance; `B-10`: a "no bets today" fallback that leaked a *different* agent's network-wide numbers to an agent with no activity of their own).
- **Non-Coder:** The backend logic behind the agent's home screen — pulls the agent's own balance, their player roster, today's betting activity across just their players, and a feed of recent coin movements involving the agent or their players.

### Section 3: Structure
1. **`getAgentDashboardDataAction`** — own profile + players (one query each, parallel), today's bet aggregation scoped strictly to the agent's own `playerIds` (explicitly no network-wide fallback per `B-10`), then a `coin_ledger` pull for recent cashier movements.
2. **`getAgentTransactionHistoryAction`** — same shape, larger limit (200 vs. 50), adds `balance_after` and a `category: 'superadmin' | 'player'` classification per row.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases — verified directly against the RPC source (`supabase/migrations/20260807000200_rebuild_v2_functions.sql:669-721`), not just the DB audit's summary:**
- **Every agent-to-player transfer double-appears in the agent's own recent-transfers feed, with one copy mislabeled "SuperAdmin."** `agent_transfer_coins` writes **two** `coin_ledger` rows per transfer (confirmed by reading the function body): one on the **player's** account with `kind = 'agent_credit'`/`'agent_debit'`, and one on the **agent's own** account with `kind = 'admin_credit'`/`'admin_debit'` (the agent's own balance side-effect). Both functions here query `coin_ledger WHERE user_id IN [me.id, ...playerIds]`, which matches **both** of those rows for the same single transfer. The row-to-display-name mapping only ever looks up `nameById.get(row.user_id)` — never `row.counterparty_id` (which **is** selected in the query but never read). For the row where `user_id === me.id` (the agent's own mirrored entry), that lookup can never succeed (the agent isn't in their own `players` map), so it always falls back to `target_name: 'SuperAdmin'` — regardless of whether the row actually came from a real superadmin action (`admin_issue_coins`) or is just the agent's own mirrored half of a transfer they themselves just made to one of their players. Net effect: depositing or withdrawing coins from a player creates what looks like **two separate transactions** in the agent's own activity feed — one correctly attributed to the player, and one phantom entry incorrectly attributed to "SuperAdmin" — for every single transfer. This affects both `getAgentDashboardDataAction` (File 18's widget) and `getAgentTransactionHistoryAction` (feeding `agent/history/page.tsx`, not yet audited).
- **This is a source-verified, sharper restatement of the ledger-`kind`-conflation issue tracked since the superadmin audit (Files 7/8/10/12):** reading `agent_transfer_coins`'s actual SQL confirms the DB audit's claim precisely — the agent's own balance-side ledger row for a player transfer really is written with the identical `kind` values (`admin_credit`/`admin_debit`) that `admin_issue_coins` uses for genuine superadmin-driven issuance. Critically, **no existing client-side filter can fix this**: `lib/ledger.ts`'s `CASHIER_KINDS` constant (used correctly here) still lumps all four cashier kinds together by design, and there is no more specific `kind` value or flag in the schema that distinguishes "my balance moved because I paid a player" from "my balance moved because the superadmin funded me" on the agent's own ledger rows — the ambiguity is structural, not a missed filter. The only reliable fix would be at the schema/RPC level (e.g. a dedicated kind, or reading `counterparty_id` to detect self-attribution and drop/relabel those rows in the query itself, which is possible for the *display* half of this bug even without a schema change).

**🗑️ Unused / Dead Code**
- `counterparty_id` is selected in both `coin_ledger` queries but never used — it's precisely the field that would fix the mislabeling half of the bug above (distinguishing "this ledger row is my own mirrored half of a transfer with player X" from "this is a real SuperAdmin-attributed row") if the mapping logic used it instead of/alongside `user_id`.

**⚔️ Functionality Conflicts** — none beyond the above.

**🔗 Mobile App & Database Misalignment**
- **Resolves the File 11 forward-flagged question:** both exports here gate on `requireAuth(['agent', 'superadmin'])` — confirming the superadmin portal's cross-folder calls into `src/app/agent/*` actions (flagged in File 11) are correctly authorized by design, not an oversight.
- **Confirmed correct, and independently verified against the live SQL** (not just the DB audit's prose): table names, `bets.total_stake/total_payout`, `coin_ledger.user_id/counterparty_id/kind/amount/balance_after`, and the `CASHIER_KINDS` vocabulary in `lib/ledger.ts` all match the actual migration exactly.

---

<a id="file-20"></a>
## File 20 — `src/app/agent/history/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `HistoryPage` (default export). Imports `getAgentTransactionHistoryAction` from `../actions` (File 19).
- **DB/Backend connections:** none directly — via the one imported action.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The agent's full transaction-history page — a Player-Transfers/Superadmin-Transfers tab split (driven by `txn.category` from File 19), filter-aware summary KPIs (available/deposited/withdrawn), search/type/date-preset filters, and a paginated desktop-table/mobile-card list. Documents two more historical fixes inline: `B-4` (date filtering now parses `created_at_iso` instead of re-parsing the already-localized display string) and `B-7` (summary cards now respect active filters instead of silently disagreeing with the filtered table beneath them).
- **Non-Coder:** The agent's full statement — every coin transfer ever made, split into "money with my players" vs. "money with the superadmin," searchable and filterable by date and type.

### Section 3: Structure
Same overall shape as the superadmin `agents/issued/page.tsx` (File 12): load → filter (tab/search/type/date) → paginate → render table/cards, plus the two-tab category split unique to this page.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **The ledger double-counting bug from File 19 directly corrupts this page's core "Player vs. Superadmin" premise.** Since `getAgentTransactionHistoryAction` labels *every* row where `user_id === me.id` as `category: 'superadmin'` — including the agent's own mirrored half of a transfer they themselves made to a player — the "Superadmin Transfers" tab on this page isn't just mislabeling a display name (as in File 18's dashboard widget); it's populating an entire tab with phantom entries that don't represent real superadmin activity. An agent reviewing "money I've received from the superadmin" here would see their own player-transfers counted as if the superadmin had sent them coins.
- **Same `'Superadmin'`/`'SuperAdmin'` capitalization typo, reproduced a third and fourth time** (lines 395, 471) — identical bug to File 18, same effect (the "hide redundant username line" check never triggers).
- **`loadError` state is set but never rendered — a step further than every other file, but still silently swallowed.** Unlike every other file in this audit (which don't even capture the action's `error` field), `loadHistory` here actually does `setLoadError(res.error)` on every load. But `loadError` is never referenced anywhere in the JSX — the error-surfacing plumbing exists and is populated correctly, it just was never connected to any visible UI element. A genuine backend failure here still renders as an empty/zero-value page with no visible error, identical in effect to every other file's version of this bug, but for a different underlying reason (unused state vs. an always-truthy check).

**🗑️ Unused / Dead Code**
- `loadError` state — set, never read.

**⚔️ Functionality Conflicts**
- Desktop/mobile duplication (consistent with every other list view audited).

**🔗 Mobile App & Database Misalignment**
- Same root cause as File 19 — no new schema/naming issues in this file itself, the display-layer damage is inherited entirely from the action.
- **Confirmed correct, positive finding:** unlike File 13 (superadmin live-game page, where the search placeholder promised player search but didn't implement it), this file's search **does** correctly match `target_name` as its placeholder ("Search @player...") promises — no drift between UI copy and behavior here.
- **Confirmed correct, positive finding:** the `B-4`/`B-7` fixes documented in File 19's comments are genuinely reflected here — date filtering uses `created_at_iso` (not a re-parsed display string) and the summary KPI cards are computed from `filteredTransactions` (filter-aware), avoiding the exact class of bug found live in the superadmin `agents/issued/page.tsx` (File 12's zero-width custom-date-range bug is a different, still-unfixed instance of date-handling fragility elsewhere in the codebase — this file shows the *correct* pattern by contrast).

---

<a id="file-21"></a>
## File 21 — `src/app/agent/players/actions.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `resolvePlayerId`, `assertOwnership`, `getPlayersAction`, `createPlayerAction`, `setPlayerActiveAction`, `transferPlayerCoinsAction`, `resetPlayerPasswordAction`, `getPlayerDetailHistoryAction` (+ `PlayerRow`, `PlayerGamePlay`, `PlayerCoinMovement` types) — the last two types are the ones imported by `superadmin/agents/[agentUsername]/page.tsx` (File 11).
- **Database & Backend Connections:** `profiles` (list/detail/update, scoped by `agent_id`), `active_sessions` (online-status lookup + delete-on-block), RPC `agent_transfer_coins(p_player_id, p_amount, p_direction)` (called via the caller's own session, not service-role), `bets` with an **inner-joined embed** on `rounds!inner(round_number, red, green, black)`, `coin_ledger` (scoped by `user_id`), Supabase Auth Admin (`createUser`, `updateUserById`).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The player-management data layer for the agent portal — list/create/block/transfer/reset-password/detail-history, every mutating export gated by `requireAuth(['agent','superadmin'])` plus an explicit `assertOwnership` check (role must be `'player'`, and if the caller is an agent, the player's `agent_id` must match) for anything using the service-role client directly. States its own architectural rule up front: money-moving RPCs are always called with the caller's own session, never the service-role client, so the database — not application code — is the source of truth for "who did this."
- **Non-Coder:** The backend for the agent's player roster — list your players, create a new one, block/unblock them, send or pull coins, reset a forgotten password, and pull up one player's full game and coin history.

### Section 3: Structure
1. **`resolvePlayerId`** — UUID or case-insensitive username lookup, unscoped by role/ownership (deliberately — ownership is checked separately).
2. **`assertOwnership`** — the shared authorization gate: confirms the target is actually a `'player'`, and that an agent caller only acts on their own players (superadmin bypasses this check entirely).
3. **`getPlayersAction`** — cross-tenant guard built structurally: an agent caller's `targetAgentId` argument is simply ignored (always uses their own id), only a superadmin's `targetAgentId` is honored.
4. **`createPlayerAction`** — `requireAuth(['agent'])` only (not superadmin) — validates name/username-format (matches DB CHECK)/password-length, creates the Auth user with `role: 'player', agent_id: auth.user.id` in `user_metadata`.
5. **`setPlayerActiveAction`** — desired-state signature (documented `B-1` fix, same pattern as the superadmin equivalent), cascading session-termination on block.
6. **`transferPlayerCoinsAction`** — validates a whole positive amount, resolves the player, then calls `agent_transfer_coins` **with the caller's own session**, explicitly *not* duplicating `assertOwnership` beforehand — the code comments this is intentional, relying on the RPC's own internal ownership check as the authority.
7. **`resetPlayerPasswordAction`** — `assertOwnership` + `auth.admin.updateUserById`.
8. **`getPlayerDetailHistoryAction`** — `assertOwnership`, then parallel `bets` (embedded `rounds!inner`) + `coin_ledger` fetches, mapped into per-hand and per-transaction display rows.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none newly found in this file; it closes the loop on two issues already tracked:
- **This is the write-path for the File 19 double-ledger-entry issue.** `transferPlayerCoinsAction`'s call to `agent_transfer_coins` is exactly what produces the two-row-per-transfer pattern (one `agent_credit`/`agent_debit` row on the player, one `admin_credit`/`admin_debit` row on the agent) that `getAgentDashboardDataAction`/`getAgentTransactionHistoryAction` (File 19) then mis-displays. No new defect here — this is the origin point of that already-documented issue, not a separate one.
- **Independently confirms the File 13 `hand_id` finding.** This file's own comment is explicit: `` `...${String(b.round_id).slice(-8)}` `` is labeled "Canonical Hand ID: last 8 characters of the **round** UUID" (line 391-393) — a second, independent confirmation (this time from the player-history code path rather than the live-game telemetry code path) that `hand_id` is a round identifier fragment, not a player identifier. Used correctly here (this is a per-player detail view, so labeling a round fragment as "Hand ID" in a table the viewer already knows is about one specific player is reasonable) — reinforcing that File 13's bug is specifically about reusing this same value as a "Player" label in an aggregate, multi-player context. The comment's claim that this is "identical to what the game app shows the player" could not be independently verified against `bsg_app/AUDIT_REPORT.md`, which doesn't document a `hand_id` field by that name — not a contradiction, just unconfirmed from this pass.

**🗑️ Unused / Dead Code** — none found.

**⚔️ Functionality Conflicts** — none found; see the positive notes below regarding this file's internal consistency.

**🔗 Mobile App & Database Misalignment**
- **Confirmed correct:** all table/column names (`profiles.agent_id/coin_balance/is_active`, `active_sessions.user_id/last_seen_at`, `bets.single_bets/double_bets/triple_bets/total_stake/total_payout/is_settled`, `rounds.round_number/red/green/black`, `coin_ledger.kind/amount/balance_after`) match the documented v2 schema exactly.
- **Notably well-reasoned, worth calling out as a positive pattern:** `getPlayerDetailHistoryAction` uses a PostgREST embed (`rounds!inner(...)`) with an explicit comment justifying it — "A real foreign key now exists, so a single embedded select is safe" — directly addressing the exact silent-row-drop failure mode that this codebase has otherwise been bitten by (per `superadmin/actions.ts`'s comment in File 8) and, in that same file, reintroduced elsewhere. This file's version shows the risk was understood and reasoned through rather than avoided by blanket rule, which strengthens rather than contradicts the earlier finding — it shows the codebase's authors know the rule, they just didn't apply it consistently everywhere (File 8's `getLatestGameDrawsAction` embed doesn't carry the same justification or the same guaranteed non-null relationship).
- **`transferPlayerCoinsAction`'s deliberate choice not to duplicate `assertOwnership`** is sound, not a gap: `agent_transfer_coins` (confirmed by reading the RPC source directly in File 19's investigation) independently raises `UNAUTHORIZED_NOT_YOUR_PLAYER` if an agent targets a player who isn't theirs, so the database itself is the authorization backstop for this specific path — appropriately different from `setPlayerActiveAction`/`resetPlayerPasswordAction`, which use the service-role client directly (no database-level authorization at all) and therefore correctly do keep their own `assertOwnership` call as the only thing standing between an agent and another agent's player.

---

<a id="file-22"></a>
## File 22 — `src/app/agent/players/[[...slug]]/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `PlayersPage` (default export, catch-all dynamic route matching `/agent/players` and `/agent/players/[username]`). Imports `createPlayerAction`, `getPlayersAction`, `setPlayerActiveAction`, `getPlayerDetailHistoryAction`, `resetPlayerPasswordAction`, `transferPlayerCoinsAction` from `./actions` (File 21). Uses `useParams()`/`useRouter()` and `window.history.replaceState` for slug-based deep linking without a full navigation.
- **DB/Backend connections:** none directly — via the six imported actions.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The agent-portal near-twin of `superadmin/agents/[agentUsername]/page.tsx` (File 11) — a two-pane players-list + selected-player-detail layout (deposit/withdraw/password-reset/block, performance stats, Game Plays / Coins History tabs with date/outcome/mode filters), minus File 11's third "P&L Audit" tab (not applicable — an agent viewing their own players doesn't need a per-agent breakdown). The URL slug (`/agent/players/[username]`) both deep-links to a specific player and is kept in sync via `replaceState` as the agent clicks between players.
- **Non-Coder:** The agent's player roster and detail view — same idea as the superadmin's agent-detail page, but for an agent managing their own players: pick a player, see their balance/status, deposit or withdraw coins, reset their password, and browse their game/coin history.

### Section 3: Structure
Same overall shape as File 11: player list (left) → selected-player header + quick actions (right) → performance-stats strip → filterable/paginated Games/Points tabs with expandable per-spin digit breakdowns.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **A property-name typo silently disables both the "Today" performance-stats scope and the Games-tab date filter — confirmed by comparing against the working version of the same logic in File 11.** Lines 93 and 116-118:
  ```js
  if ((spin as any).createdAtIso) { ... }              // performanceStats, line 93
  const spinDateStr = (spin as any).createdAtIso        // filteredGames, line 116-118
    ? new Date((spin as any).createdAtIso)...
    : spin.created_at
  ```
  `PlayerGamePlay` (File 21) defines the field as `created_at_iso` (snake_case) — there is no `createdAtIso` property, which is exactly why an `as any` cast was needed to write this at all (plain `spin.createdAtIso` would be a TypeScript compile error). At runtime, `(spin as any).createdAtIso` is always `undefined`, so:
  - `performanceStats`'s "today" branch can never execute — the `statsScope === 'today'` vs `'lifetime'` toggle is **non-functional**; both settings show the exact same all-time totals.
  - `filteredGames`'s date filter always falls back to comparing the human-readable `spin.created_at` display string against an ISO `'YYYY-MM-DD'` filter string, which will essentially never match — the custom-date-picker filter on the Games tab is **effectively broken**, almost always returning zero results for any specific date chosen.
  The direct comparison point: `superadmin/agents/[agentUsername]/page.tsx` (File 11) has the *same* logic written correctly, using `spin.created_at_iso` with no cast — confirming this is a regression/typo specific to this file, not a shared/inherited defect. Notably, `filteredPoints` (Coins History tab, lines 135-146) in this same file correctly uses `tx.created_at_iso` — so only the Games tab's date handling is broken, not the Points tab's.
- **Client/server/DB username-regex mismatch, a third confirmed instance of the same bug class.** `isUsernameValid = /^[a-zA-Z0-9]{3,20}$/.test(usernameInput)` (line 52) disallows underscores, while `createPlayerAction` (File 21) and the live DB CHECK (`profiles_username_format`, already verified in File 9/10) both allow `[A-Za-z0-9_]{3,20}`. Same effect as the earlier two instances: a legitimate `player_01`-style username is rejected client-side before it ever reaches a server that would accept it.

**🗑️ Unused / Dead Code** — none beyond the practical dead-ness of the `createdAtIso` branches (they're reachable code, just never true).

**⚔️ Functionality Conflicts**
- Desktop-table/mobile-card duplication for the Games tab, identical pattern (and identical win-highlighting math, verbatim duplicated between mobile/desktop branches) to File 11.
- An invalid/stale username in the URL slug (e.g. a bookmarked link to a player who was since reassigned or deleted) silently falls through to selecting the first player in the list rather than showing any "not found" indication — minor, low-severity UX gap, not a data-integrity issue.

**🔗 Mobile App & Database Misalignment**
- **Confirmed correct:** the win-highlighting logic (`spin.black`, `spin.green+spin.black`, `spin.red+spin.green+spin.black`) matches the `rounds.red/green/black` schema, consistent with every other file that implements this same digit-matching logic (Files 8, 11, 13).
- No new schema drift found in this file.

---

<a id="file-23"></a>
## File 23 — `src/app/agent/profit/actions.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `getAgentProfitReportAction(params)` (+ `ProfitReportParams`, `PlayerProfitRow`, `ProfitReport` types), helper `istRange`.
- **Database & Backend Connections:** `profiles` (`id, username, full_name, coin_balance, is_active`, filtered by `agent_id`), `bets` (`user_id, total_stake, total_payout, created_at`, three parallel unbounded (`.range(0,999999)`) reads: all-time, today, and date-window-filtered). Gated by `requireAuth(['agent','superadmin'])`.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The P&L report data layer, shared by the agent portal's own `/agent/profit` page (File 24) and the superadmin's per-agent "P&L Audit" tab (File 11). Documents three fixes: `M-7` (a `game_history` fallback query against a table that never existed), `A-8` (an agent can no longer read another agent's book by passing a `targetAgentId`), `S-4` (no `parent_agent_id`, one-level hierarchy only).
- **Non-Coder:** The numbers behind the profit report — for every player under an agent, how much they've bet, won, and the net result, plus running today/lifetime totals.

### Section 3: Structure
1. **`istRange`** — resolves a date preset or explicit date into IST day-boundary ISO strings.
2. **Authorization** — `agentId = (superadmin AND targetAgentId given) ? targetAgentId : auth.user.id` — an agent caller always reports on themselves regardless of what's passed.
3. **Roster fetch** — all players under `agentId`, ordered by username; short-circuits to `EMPTY` if none.
4. **Three parallel `bets` reads** — lifetime, today, and the active date-window filter.
5. **Per-player aggregation** — stake/payout/play-count/last-played, computed in JS over the filtered window; rows with zero plays are dropped when a window filter is active.
6. **Search + sort (by `total_stake` desc) + in-memory pagination.**

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Guaranteed error/empty state on every initial load of the superadmin's P&L Audit tab, traced across files.** This action has **no username-to-UUID resolution** (unlike `resolveAgentId` in Files 10/21) — it uses `params.targetAgentId` verbatim as `agentId` and queries `profiles.agent_id = agentId` directly (`agent_id` is a UUID column). `superadmin/agents/[agentUsername]/page.tsx` (File 11) calls this with `targetAgentId: resolvedAgentIdRef.current || agentUsername`, and `loadAgentDetails` fires this call **in the same `Promise.all`** as the `getAgentDetailAction` call that's responsible for *populating* `resolvedAgentIdRef.current` in the first place. On every initial page load, `resolvedAgentIdRef.current` is still `''` (falsy) at the moment both promises are dispatched, so `targetAgentId` is the raw **username string** (e.g. `"agent01"`), not a UUID. Querying `profiles.agent_id = 'agent01'` against a UUID column will fail with a Postgres `invalid input syntax for type uuid` error, caught by `if (playersRes.error) throw ...` — meaning the P&L tab's summary/table starts every page load in its error state (`Could not load report: players: invalid input syntax for type uuid: "..."`), only self-correcting once the 90-second silent poll (or a manual refresh/filter change) re-fires with the by-then-resolved UUID. This is a guaranteed, reproducible first-load defect, not an edge case — traced precisely by reading this file's lack of a resolution step against File 11's actual call-site.

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts**
- **API-contract mismatch with the rest of the codebase's convention.** Every other "resolve an identifier" action in the app (`resolveAgentId` in Files 10/21) accepts *either* a UUID *or* a username and resolves accordingly — this is the one action in the app that silently assumes `targetAgentId` is already a UUID, breaking the one call site (File 11) that (reasonably, given the rest of the app's convention) sometimes passes a username instead.
- Worth noting, not a bug: the summary's `todays_profit`/`lifetime_profit` are always computed from fixed, unfiltered `today`/`all-time` queries, while `total_stake`/`total_payout`/`margin_pct` in that same summary object *do* respect the active date-preset/custom-date filter. This is a reasonable design (fixed reference points alongside a filtered view) and the field names telegraph it, but it means selecting, say, "7 Days" changes half the summary strip and not the other half — worth being aware of when reading File 11's/File 24's rendering of this data.

**🔗 Mobile App & Database Misalignment**
- **Confirmed correct:** `profiles.agent_id/coin_balance/is_active`, `bets.user_id/total_stake/total_payout/created_at` all match the documented v2 schema.
- **Confirmed correct:** the in-file comment "both figures come from `bets`, written by `settle_round()`, so the report and the player's own history cannot disagree" is consistent with the DB audit's documentation of `settle_round()` writing authoritative payout figures (no client-side recomputation) — matches the same design principle already confirmed in `players/actions.ts` (File 21).

---

<a id="file-24"></a>
## File 24 — `src/app/agent/profit/page.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `AgentProfitPage` (default export). Imports `getAgentProfitReportAction` from `./actions` (File 23).
- **DB/Backend connections:** none directly — via the one imported action (no `targetAgentId` passed, so the File 23 UUID-mismatch bug does not apply here — an agent always reports on themselves).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The agent's own P&L report page — 5 summary KPI cards (today's/lifetime P&L, total bets, total wins, house margin), date-preset/custom-date/search filters, and a paginated per-player breakdown table/cards. 60s auto-poll.
- **Non-Coder:** The agent's own profit-and-loss statement — how much they've made or lost overall and per player, filterable by date.

### Section 3: Structure
Same shape as File 23's other consumer (File 11's P&L tab) but as a standalone full page rather than an embedded tab: preset pills (Today/Lifetime/7D/30D) + custom date popover + search → summary cards → paginated table/cards.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Same silent-error-swallowing pattern found throughout the codebase.** `loadProfitReport`'s `if (res)` check is always true (the action always returns an object, even on error) — a backend failure renders as an empty "No player activity found for this period" state rather than a visible error. Consistent with the pattern already flagged extensively elsewhere; not a new defect, just another occurrence.

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts** — none found; the preset-pill highlighting correctly accounts for the custom-date-picker taking priority (`datePreset === btn.value && !filterDate`), avoiding the kind of visual/state disagreement seen elsewhere.

**🔗 Mobile App & Database Misalignment**
- **Positive, confirmed-correct finding worth contrasting with File 12:** this page's custom-date filter works correctly because it relies entirely on `istRange`'s properly-computed day boundaries (`T00:00:00+05:30` to `T23:59:59.999+05:30`) in File 23 — unlike the superadmin `agents/issued/page.tsx` (File 12), which builds a broken zero-width window itself instead of delegating to a shared, correct day-boundary helper. This is a good example of why File 23's `istRange` pattern (also used by `superadmin/actions.ts`'s `istDayStartISO`/`istTime` and `agent/actions.ts`'s `istDayStartISO`) is the safer approach, and a concrete illustration of what File 12 should have done instead of hand-rolling its own (broken) date-range logic.
- No new schema drift.

---

## Folder-Level Completion Summary — `src/app/agent/`

### 1. Folder Architecture & Overview
This folder is the Agent ("Back Office") web console, structurally parallel to `src/app/superadmin/` — a `layout.tsx` shell, a `login/` flow with the same defense-in-depth pattern as the superadmin login, a Cashier home page (`page.tsx`/`actions.ts`), a `players/` sub-area (roster + per-player detail/moderation, the largest part of this folder), a `profit/` P&L report (shared logic with the superadmin's per-agent P&L tab), and a `history/` full transaction ledger. Every server action gates on `requireAuth(['agent','superadmin'])` (confirmed, resolving the cross-portal-coupling question flagged in File 11), with money-moving RPCs (`agent_transfer_coins`) always called using the caller's own session per the same architectural rule already seen in the superadmin folder.

### 2. Folder-Wide Interdependencies
- `layout.tsx` (File 15) → `@/app/actions/auth` (File 14) for sign-out, mirroring File 4.
- `agent/actions.ts` (File 19) and `agent/players/actions.ts` (File 21) both read `coin_ledger` via `lib/ledger.ts`'s `CASHIER_KINDS`, and both inherit the same double-entry-ledger display bug traced to its origin in `agent_transfer_coins` (File 21's write path → File 19's read/display path → Files 18/20's UI).
- `agent/players/actions.ts` (File 21) exports `PlayerGamePlay`/`PlayerCoinMovement`/`PlayerRow` types and `getPlayerDetailHistoryAction`, consumed both by this folder's own `players/[[...slug]]/page.tsx` (File 22) **and** by `superadmin/agents/[agentUsername]/page.tsx` (File 11) — confirmed correctly authorized for both callers.
- `agent/profit/actions.ts` (File 23) is shared the same way, consumed by both `agent/profit/page.tsx` (File 24) and `superadmin/agents/[agentUsername]/page.tsx`'s P&L tab (File 11) — but only the superadmin call site triggers File 23's UUID/username contract bug, since the agent-portal caller never passes `targetAgentId`.

### 3. Folder Bug & Conflict Summary

**The single highest-value finding in this folder: the double-entry ledger design produces phantom "SuperAdmin" transactions in the agent's own activity views.** Traced from its origin (`agent_transfer_coins` writing a second, agent-side `admin_credit`/`admin_debit` row for every player transfer — verified directly against the RPC SQL) through to its two display-layer consequences: File 18's dashboard widget mislabels one row per transfer, and File 20's "Superadmin Transfers" tab is structurally populated with entries that were never superadmin-initiated. This is the same root schema ambiguity already tracked through the superadmin folder (Files 7/8/10/12), now confirmed via direct SQL inspection rather than inference, and shown to corrupt agent-facing UI, not just superadmin-facing KPIs.

**A second cross-file bug, newly found in this folder: `getAgentProfitReportAction`'s missing username-to-UUID resolution (File 23) breaks the superadmin's P&L tab (File 11) on every single initial load** — a guaranteed, reproducible defect (not a rare race), caused by File 11 firing two dependent-in-spirit requests in parallel via `Promise.all` without a resolved agent ID being available yet for the second.

**Systemic pattern, still present but with two confirmed exceptions this folder:** the silent-error-swallowing pattern from the superadmin folder recurs in Files 18/20/24 — but File 20 (`agent/history/page.tsx`) is notably the *only* file in the entire audit so far that actually threads the error state through (`loadError`), just without ever rendering it — a step closer to correct than anywhere else.

**Concrete, one-off verified bugs:**
- Same stuck-login-spinner bug as the superadmin login (Files 16).
- A sharper account-status oracle than the superadmin login, since it names the exact role (Files 16-17).
- A genuinely unreachable code branch, verified against the DB's `role` CHECK constraint (File 17).
- A capitalization typo (`'Superadmin'` vs `'SuperAdmin'`) defeating a UI check, found in two files (Files 18, 20).
- A property-name typo (`createdAtIso` vs `created_at_iso`) silently disabling a date filter and a stats toggle, confirmed via `as any` casts and by contrast with the correctly-written twin logic in File 11 (File 22).
- A third and fourth instance of the client/server/DB username-regex mismatch already found in the superadmin folder, now for player creation (Files 9→22, and confirmed again structurally in File 21's create-player validation matching the DB).

**Dead code:** the unused default parameter in `signOutAction` (File 14, trivial); no other dead code found in this folder — notably **less** dead/unused code than the superadmin folder overall.

**Positive, confirmed-correct findings** (no action needed): `lib/ledger.ts`'s `CASHIER_KINDS`/`LEDGER_KINDS` vocabulary is well-designed and correctly used everywhere it's referenced; `players/actions.ts`'s embed usage is explicitly and correctly justified by a real foreign key (contrasting favorably with the superadmin folder's less consistent embed usage); `players/actions.ts`'s deliberate choice to rely on RPC-level authorization instead of duplicating an ownership check is sound; `agent/profit/actions.ts`'s and `agent/profit/page.tsx`'s IST day-boundary date-range logic is correctly implemented, in direct contrast to the superadmin folder's broken zero-width custom-date filter (File 12); every table/column name referenced across all 11 files in this folder matches the documented v2 schema exactly, with zero naming drift found.

Audit for folder `src/app/agent/` is complete! Please provide the next folder to audit.

---

## Group: `src/app/api/*`

<a id="file-25"></a>
## File 25 — `src/app/api/auth/login/route.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `POST(request: Request)`.
- **Database & Backend Connections:** `supabase.auth.signInWithPassword` (anon client, built inline, not `lib/supabase.ts`'s `createClient()`), `profiles.select('balance, is_active')` (**`balance` is a v1 column name, dropped in the v2 rebuild** — confirmed against `DATABASE_AUDIT_REPORT.md`'s schema map, which lists the current column as `coin_balance`), Supabase Auth Admin `getUserById` (service-role, to resolve an agent's display name).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** An unauthenticated POST endpoint duplicating a full username/password login flow independently of both the dashboard's own auth actions and `bsg_app`'s actual login path. Carries its own header comment: **"⚠ DEAD ENDPOINT — RECOMMENDED FOR DELETION"**, explaining `bsg_app`'s `ApiService.login` talks to Supabase directly instead. This is independently confirmed by reading `bsg_app/lib/services/api_service.dart` directly in this pass: its own comment states *"v2 talks to Supabase Auth plus the session RPCs. There is no longer a duplicate `/api/auth/login` implementation in the dashboard to drift from (audit finding M-6)"* — the mobile app's source code explicitly documents that it does not call this route.
- **Non-Coder:** A second, unused front door for logging in that nobody actually uses anymore — the real app talks to the login system directly instead.

### Section 3: Structure
1. Parse `username`/`password` from the JSON body; derive `email` via the `@bestsmartgame.com` convention.
2. `signInWithPassword` — 401 on failure.
3. Block-check via `user_metadata.status === 'Blocked'`.
4. Role-check via `user_metadata.role !== 'player'`.
5. Fetch `profiles.balance, is_active` for a "real-time" balance and a second block-check.
6. Resolve the agent's display name via `getUserById` using the service-role key.
7. Return a JSON payload with `token`, user fields (including both `agent_name` and `agentName` — documented `M-6` fix for a snake_case/camelCase mismatch the Flutter model reads).

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases — this is not just harmless dead code; as written, it is a live, unauthenticated block-check bypass, reachable today:**
- **The block/suspension check can never actually run, for anyone.** Step 5's query selects `profiles.balance` — a column that was renamed to `coin_balance` in the v2 schema rebuild (`DATABASE_AUDIT_REPORT.md`, File 4). This query will error (`42703 undefined column`, the same failure mode the DB audit documents recurring elsewhere in this codebase's v1-era leftovers). The code destructures only `{ data: prof }` — **the query's `error` is never even captured** — so the failure is entirely silent, and `prof` ends up `null`/`undefined`. Since the `is_active` check lives inside `if (prof) { ... }`, that entire block — the only place this route checks the *authoritative* `profiles.is_active` flag — never executes, for any request, ever.
- **The two remaining checks (steps 3-4) are also structurally unable to fire.** Both read from `user_metadata` (`status`, `role`), but per the DB audit's S-2 fix (already confirmed in File 1/7 of this report and File 7 of the DB audit), v2 writes role/status information to `app_metadata`, not the client-influenced `user_metadata` — so `userMetadata.status`/`userMetadata.role` are simply never populated with real values by the current schema, meaning these checks are effectively always skipped too (`userMetadata.status === 'Blocked'` and `userMetadata.role && userMetadata.role !== 'player'` are both false by default when the fields don't exist).
- **Net effect: every authorization check in this route is dead, while the route itself is very much alive.** This is an unauthenticated (no session/role gate beyond the password check itself), publicly reachable `POST /api/auth/login` endpoint. Anyone who knows (or guesses/phishes) valid credentials for **any** account — including a blocked player, a blocked agent, or even a non-player role, since the role check can't fire either — can call this endpoint directly and receive back a working Supabase `access_token`, completely bypassing every intended restriction this specific route was written to enforce. The DB audit categorized this route primarily as an architecture/maintenance concern ("two divergent implementations... every future auth rule has to be written twice"); tracing the actual consequence of its broken column reference shows it's also a live, exploitable authorization bypass sitting in the deployed application today, independent of whether any legitimate client calls it.
- Reported `balance` is always `0` in practice (falls back to `Number(userMetadata.balance || 0)`, and `user_metadata.balance` is never populated in v2 either) — a correctness bug on top of the security one, though moot given the above.

**🗑️ Unused / Dead Code**
- The entire file, per its own header comment and independently confirmed against `bsg_app`'s source. The file's own comment explains it's being kept only because "this workspace is not under version control, so a deletion here would be unrecoverable" — worth flagging that this reasoning may now be outdated if version control has since been established for this project.

**⚔️ Functionality Conflicts** — N/A (no other route implements the same operation within the web dashboard itself; the conflict is with `bsg_app`'s own direct-to-Supabase login path, as its own comment states).

**🔗 Mobile App & Database Misalignment**
- **Confirmed dead via two independent sources** (this route's own comment, and `bsg_app/lib/services/api_service.dart`'s own comment) — a rare case where both sides of a cross-repo relationship explicitly document the same conclusion.
- **Confirmed column drift:** `profiles.balance` referenced here does not exist in the live v2 schema (`coin_balance` is current) — exactly the mismatch `DATABASE_AUDIT_REPORT.md` flagged (Executive Summary #10).

---

<a id="file-26"></a>
## File 26 — `src/app/api/auth/logout/route.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `POST()` — takes no parameters.
- **Database & Backend Connections:** `supabase.auth.signOut()` via the cookie-bound `createClient()` from `@/lib/supabase`.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** A minimal POST endpoint that signs out whatever session the request's cookies resolve to, and unconditionally returns `{ success: true }`.
- **Non-Coder:** A logout button's backend, in theory — but as built, it can only react to a browser's own cookies, not a mobile app's login token.

### Section 3: Structure
1. Build the cookie-bound Supabase client.
2. `signOut()`.
3. Always respond `{ success: true, message: 'Logged out successfully' }`.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Cannot actually log out the kind of client this API surface is otherwise built for.** Its two sibling routes in this same folder (Files 25, 27) both authenticate via an `Authorization: Bearer <token>` header — the correct pattern for an external/mobile API client that has no access to the dashboard's own browser cookies. This route instead uses the cookie-bound `createClient()` and doesn't even declare a `request` parameter, so it has no way to read a bearer token even if it wanted to. Called by an external client (mobile app, script, `curl`) with a bearer token and no dashboard cookies, this route's `signOut()` has no session to act on — it's effectively a no-op — yet it still unconditionally reports `{ success: true }`, silently lying about having ended a session that was never touched.
- Called by the dashboard's own browser session, this route is functionally redundant with `signOutAction` (File 14) — which is what both portal layouts (Files 4, 15) actually use — so this route currently has no real caller for either of its two plausible use cases.

**🗑️ Unused / Dead Code**
- No caller found anywhere in `bsg_web_dashboard` or `bsg_app` (confirmed by grep across both repos). Unlike File 25, this route carries no "dead endpoint" warning comment despite being equally unreferenced — worth the same deletion consideration, or at minimum fixing to accept a bearer token if it's meant to serve external clients.

**⚔️ Functionality Conflicts**
- Mismatched authentication mechanism relative to its own sibling routes in this three-file folder (cookie-based here vs. bearer-token in Files 25/27) — an internal inconsistency within a single, small API surface that should plausibly share one convention.

**🔗 Mobile App & Database Misalignment**
- `bsg_app` does not call this endpoint (confirmed by grep — no `/api/` references anywhere in `bsg_app` besides the login-route comment already noted in File 25); mobile sign-out goes through the `session_logout` RPC per `DATABASE_AUDIT_REPORT.md`, an entirely separate and unrelated mechanism.

---

<a id="file-27"></a>
## File 27 — `src/app/api/user/profile/route.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `GET(request: Request)`.
- **Database & Backend Connections:** `supabase.auth.getUser(token)` (bearer-token-scoped anon client, built inline), `profiles.select('balance, is_active, username')` — **same dropped `balance` column as File 25.**

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** A bearer-token-authenticated GET endpoint returning a user's profile summary (id, username, name, balance, status). Structurally the read-only counterpart to File 25's login route, sharing its exact broken-column defect.
- **Non-Coder:** A "who am I / what's my balance" lookup for a logged-in user — but its balance/status numbers are silently wrong for the same reason as the login endpoint.

### Section 3: Structure
1. Extract and validate a `Bearer` token from the `Authorization` header.
2. `getUser(token)` — 401 if invalid/expired.
3. Fetch `profiles.balance, is_active, username`; fall back to `user_metadata` fields if the query fails.
4. Return `id, username, name, balance, status`.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Same root defect as File 25, same consequence pattern.** The `profiles.select('balance, ...')` query fails against the live v2 schema (`coin_balance`, not `balance`) exactly as in File 25 — `{ data: prof }` is destructured without checking `error`, so `prof` is silently `null`, and the `if (prof) { if (!prof.is_active) {...} }` block — again, the only authoritative block-check in this route — never executes. A blocked account holding a still-valid (unexpired) bearer token would have this endpoint report `status: 'Active'` (the `user_metadata.status` fallback, which per the S-2 design is never actually populated with real status data) rather than reflecting their true blocked state. Lower severity than File 25 (this route can't grant a *new* session, only misreport an existing one), but it's the same bug, independently reachable.
- `balance` is always reported as `0` for the same reason as File 25 (`profiles.balance` doesn't exist; `user_metadata.balance` is never populated in v2).

**🗑️ Unused / Dead Code**
- No caller found in `bsg_web_dashboard` or `bsg_app` (confirmed by grep across both repos) — functionally in the same "orphaned" category as File 25, though it carries no explicit warning comment. `DATABASE_AUDIT_REPORT.md` independently reached the same conclusion ("carries no such note but appears equally unreferenced by any live call site").

**⚔️ Functionality Conflicts** — none beyond the shared root cause with File 25.

**🔗 Mobile App & Database Misalignment**
- **Confirmed column drift**, identical to File 25 — `profiles.balance` vs. the live `coin_balance`.
- No `bsg_app` caller found (consistent with `ApiService`'s documented v2 direct-to-Supabase design).

---

## Folder-Level Completion Summary — `src/app/api/`

### 1. Folder Architecture & Overview
Three Next.js Route Handlers, all left over from a pre-v2 architecture where the dashboard itself brokered mobile-app authentication and profile reads. The v2 rebuild moved that responsibility entirely into `bsg_app` talking to Supabase Auth and RPCs directly (`session_login`, `session_logout`, etc., per `DATABASE_AUDIT_REPORT.md`), leaving all three routes without a live caller. This is the smallest folder in the app by file count, and the one with the highest concentration of confirmed-dead code anywhere in this audit.

### 2. Folder-Wide Interdependencies
- All three routes are independent of each other and of the rest of the dashboard (no shared helpers, no imports from `lib/auth-guard.ts`'s `requireAuth`, no use of `lib/supabase.ts`'s `createAdminClient()`) — each hand-builds its own Supabase client inline, consistent with this being legacy code that predates the rest of the codebase's now-standard patterns.
- Cross-referenced directly against `bsg_app/lib/services/api_service.dart` in this pass (not just inferred from the DB audit) — its own comments confirm none of these three routes are called by the mobile app.

### 3. Folder Bug & Conflict Summary
- **Two routes (Files 25, 27) share one root defect — a query against the dropped `profiles.balance` column that silently fails and disables their own block/suspension check** — elevating File 25 in particular from "dead code" to "a live, unauthenticated authorization bypass," since its checks being disabled means *any* valid credential pair (blocked or not, any role) can obtain a working session token through it. This is a more severe framing than the DB audit's original "recommended for deletion" characterization, arrived at by tracing the exact runtime consequence of the broken column reference rather than stopping at "this route is unused."
- **File 26 (logout) has no warning comment but is equally dead**, and additionally uses a different, incompatible auth mechanism (cookies) than its two siblings (bearer tokens) — internally inconsistent even considered on its own.
- All three routes are confirmed unreferenced by both `bsg_web_dashboard` (grep) and `bsg_app` (grep + the mobile app's own source comments).

### 4. Recommendation Context (informational, no fix applied)
Per this audit's no-fixes rule, no code changes are made here — but given all three routes are (a) confirmed dead by multiple independent sources, (b) one of them a live authorization bypass rather than merely inert, and (c) the codebase's own existing comment already flags File 25 for deletion once version control exists, this folder is the single most actionable cleanup target found in the entire audit so far.

Audit for folder `src/app/api/` is complete! Please provide the next folder to audit.

---

## Group: `src/lib/*`

<a id="file-28"></a>
## File 28 — `src/lib/auth-guard.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `requireAuth(allowedRoles: AppRole[])`, `AppRole`, `VerifiedUser`, `AuthGuardResult`.
- **Database & Backend Connections:** `supabase.auth.getUser()` (cookie-bound client), then `profiles.select('id, username, role, coin_balance, is_active, agent_id')` via an inline-constructed service-role client.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The single, central authorization gate this entire report has referenced (forward-flagged) across every file that calls it — confirmed here to do exactly what those files' comments claimed: resolve the current session, then perform a fresh, authoritative `profiles` lookup, failing closed on any error, missing profile, `is_active === false`, or a role outside the caller-specified allow-list. Documents its own historical fix (`S-3`): an old version fell back to trusting `user.user_metadata.role` — self-service-writable — whenever the profile query failed, exactly the class of bug the DB audit's S-2 fix closed in the database layer, mirrored here in the application layer.
- **Non-Coder:** The one function nearly every button-click and page-load in this app runs through before touching money or sensitive data — "are you logged in, are you still active, and are you allowed to do this specific thing?" — and if it can't get a clear "yes" to all three, it says no.

### Section 3: Structure
1. Resolve the session user via the cookie-bound client; fail if none.
2. Build a service-role client inline (not via `lib/supabase.ts`'s `createAdminClient()` — see below).
3. Fetch the caller's own `profiles` row by real column names only (documents the same `S-1`-class column-name defect already seen elsewhere in this codebase).
4. Fail closed on query error, missing row, `is_active === false`, or role not in `allowedRoles`.
5. Return a fully-typed `VerifiedUser` on success.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none functionally; this function's own logic is sound and fails closed at every branch (confirmed by direct reading, not just by the comments' own claims).

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts**
- **The most significant instance of the "inline service-role client instead of `createAdminClient()`" duplication pattern found anywhere in this audit**, precisely because this is the single most-invoked piece of authorization logic in the codebase. Comparing byte-for-byte against `lib/supabase.ts`'s `createAdminClient()` (File 29): identical runtime options (`{ auth: { autoRefreshToken: false, persistSession: false } }`), but this inline version omits the `<Database>` generic type parameter that `createAdminClient()` carries — meaning the subsequent `.from('profiles').select(...)` call here has **no compile-time column-name checking**, in the one function whose entire documented purpose (per its own `S-3`/`S-1` comments) is to prevent exactly the class of bug (querying a wrong/dropped column name, silently getting `null`, falling through to an unsafe default) that a typed client is specifically designed to catch at compile time. This is the same duplication already flagged in `superadmin/login/actions.ts` (File 6) and `agent/login/actions.ts` (File 17), now confirmed a third time, in the highest-stakes location.
- **Inconsistent fail-open/fail-closed behavior compared to `middleware.ts` (File 1) under the identical failure condition.** When `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` are missing, this function correctly **fails closed** (`return { error: 'Server configuration error...' }`, denying the action). `middleware.ts`'s page-route guard, facing the equivalent missing-env-var condition, **fails open** (passes every request through unauthenticated, per File 1's finding). The two layers of this app's defense-in-depth model disagree on the safe default for the same misconfiguration — page navigation would be wide open while the server actions behind those pages would correctly refuse to run, which is a partially-safe but confusing combination (a misconfigured deploy would show admin UI chrome to anyone, per File 4/15, while every actual data-mutating action inside it correctly fails).

**🔗 Mobile App & Database Misalignment**
- **Confirmed correct, and now directly verified rather than inferred:** this is the exact function `DATABASE_AUDIT_REPORT.md` (File 7) and `middleware.ts`'s own comment (File 1) both referenced but deferred — "server actions independently re-verify through `requireAuth()`, which reads `public.profiles` directly" is accurate. This closes out the one dependency both of those earlier findings were waiting on.
- `profiles.id/username/role/coin_balance/is_active/agent_id` match the documented v2 schema exactly.

---

<a id="file-29"></a>
## File 29 — `src/lib/supabase.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `createClient()` (cookie-bound, RLS-respecting), `createAdminClient()` (service-role, bypasses RLS) — both generic over the `Database` type from `database.types.ts`.
- **Database & Backend Connections:** none directly; this is the factory module every other file's Supabase access ultimately should route through.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The canonical, correctly-typed pair of Supabase client constructors for this codebase. Its own header comment explains the design rationale precisely: typing both clients against the generated `Database` schema turns a wrong/dropped column reference into a **compile-time error** instead of a silent runtime `{ data: null, error }` — exactly the failure class documented as causing the `S-1`/`S-4` historical bugs referenced throughout this codebase's comments. `createClient()` is documented as required for any money-moving RPC (identity via `auth.uid()`); `createAdminClient()` carries an explicit warning that holding the service-role key is not an identity and must only follow a `requireAuth()` check.
- **Non-Coder:** The one correct, "do it this way" toolkit for talking to the database — one version that acts as the logged-in user, one version that can see everything but should only be used after already checking who's asking.

### Section 3: Structure
1. `createClient()` — builds a cookie-bound SSR client, with a `try/catch` around `setAll` explicitly handling the read-only-cookies case when called from a Server Component (documented, intentional).
2. `createAdminClient()` — throws immediately if service credentials are missing (fail-closed, contrasting with `middleware.ts`'s fail-open equivalent, per File 28's finding above), otherwise returns a typed service-role client.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none found; this file is a clean, well-reasoned reference implementation.

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts** — none within this file; it is the *target* of the duplication conflicts already documented elsewhere (Files 6, 17, 28), not a source of any itself.

**🔗 Mobile App & Database Misalignment**
- N/A — pure client-factory code, no direct table/RPC access. The design principle stated in its own comment (typed clients as a mechanical guard against silent column-name drift) is exactly what the DB audit's and this report's various `S-1`/`M-6`/column-drift findings independently demonstrate the *cost* of bypassing — every place in this codebase that hand-rolled its own untyped client instead of using this module's exports (Files 6, 17, 25, 27, 28) is precisely where a dropped/renamed column silently slipped through.

---

<a id="file-30"></a>
## File 30 — `src/lib/rpc.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** Types `CurrentRound`, `PlaceBetResult`, `MyRoundResult`, `SessionLoginResult`, `SessionHeartbeatResult`, `AgentTransferResult`, `AdminIssueResult`, `PlayLimits`, `RecentRound`; function `asRpc<T>(data: unknown): T`.
- **Database & Backend Connections:** none directly — this is a pure type-contract module mirroring the `jsonb` return shapes of the RPCs defined in `supabase/migrations/20260807000200_rebuild_v2_functions.sql`, used by every file in this audit that calls `.rpc(...)` (Files 8, 10, 21, and others).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** Since Postgres RPCs returning `jsonb` can only be typed as opaque `Json` by the generated `database.types.ts`, this file hand-declares the actual shape once, centrally, and provides `asRpc<T>()` — a deliberately explicit double-assertion (`data as unknown as T`) — as the single, greppable place every RPC call site trusts that contract. Its own header comment states the discipline this requires: "If you change an RPC's return shape in SQL, change it here in the same commit."
- **Non-Coder:** A shared dictionary translating "what the database's black-box functions hand back" into a shape the rest of the app's code can rely on, kept in one place so it can't quietly drift out of sync in only some of the places that use it.

### Section 3: Structure
Pure type declarations plus one trivial identity-cast helper — no control flow to trace.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none; this is inert type-level code.

**🗑️ Unused / Dead Code** — none found; every exported type here was observed in active use at its corresponding call site earlier in this audit (`AgentTransferResult`/`AdminIssueResult` in Files 10/21, `CurrentRound` in Files 8/13).

**⚔️ Functionality Conflicts** — none.

**🔗 Mobile App & Database Misalignment**
- **Confirmed correct where independently cross-checked in this audit:** `AgentTransferResult` (`success, player_coin_balance, agent_coin_balance`) and `AdminIssueResult` (`success, agent_coin_balance`) match the exact `jsonb_build_object(...)` calls read directly from `agent_transfer_coins`/`admin_issue_coins`'s SQL bodies earlier in this session (File 19's investigation) — not just inferred, verified against the actual function source.
- **Worth being precise about, not a bug:** `asRpc<T>()` provides **zero runtime validation** — it's a naming/code-review convention, not a safety mechanism. If an RPC's actual return shape ever drifted from what's declared here (the exact scenario the file's own comment warns against), `asRpc` would silently produce an incorrectly-typed object with no runtime error — the same silent-failure class this codebase's `S-1`/`M-6`/`S-4` historical bugs all belong to, just at the RPC-contract layer instead of the table-column layer. The file is upfront about this being a discipline convention rather than a technical guarantee, so this is a limitation to be aware of rather than a defect in what's actually written.

---

<a id="file-31"></a>
## File 31 — `src/lib/ledger.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `LEDGER_KINDS`, `LedgerKind` (type), `GAMEPLAY_KINDS`, `CASHIER_KINDS`, `isCredit()`, `ledgerKindLabel()`, `TransferDirection` (type), `toWholeCoins()`, `formatCoins()`.
- **Database & Backend Connections:** none directly — a pure-logic module mirroring `coin_ledger.kind`'s CHECK-constrained enum (7 values), used by Files 8, 10, 19, 21 wherever `coin_ledger` is queried or a transfer amount is validated.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The single source of truth for the seven `coin_ledger.kind` values the database can produce, split into `GAMEPLAY_KINDS` (stake/refund/payout) and `CASHIER_KINDS` (the four agent/admin credit-debit pairs), plus small validated helpers for sign-based credit/debit detection, human-readable labeling, and coercing a user-supplied amount to a positive whole number. Its own header comment documents the historical problem this file was built to solve: v1 kept three divergent kind-vocabulary lists across the app and dashboard that together referenced nine values no RPC ever actually wrote, silently discarding rows any filter built against the wrong list would have caught.
- **Non-Coder:** The official, single dictionary of "what kind of coin-ledger entry is this" — bet placed, bet refunded, win paid out, agent gave/took from a player, or admin gave/took from an agent — so every part of the app that reads the money trail agrees on what the labels mean.

### Section 3: Structure
Pure constant/type declarations plus four small pure functions — no control flow of note.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none in this file's own logic.

**🗑️ Unused / Dead Code**
- `GAMEPLAY_KINDS` is exported but no caller was observed using it anywhere in this audit's pass through `src/app/` — every consumer found so far (Files 8, 10, 19, 21) uses `CASHIER_KINDS` for ledger filtering. Not necessarily dead in the whole codebase (could be used in `supabase/functions/round-scheduler`, outside this audit's scope), but worth noting as unreferenced from the web dashboard's own application code.

**⚔️ Functionality Conflicts** — none within this file.

**🔗 Mobile App & Database Misalignment**
- **This file is the precise, confirmed origin point of the ledger-`kind`-conflation issue traced repeatedly through this report (Files 7, 8, 10, 12, 18, 19, 20).** `CASHIER_KINDS` groups `agent_credit`, `agent_debit`, `admin_credit`, and `admin_debit` together as "movements a cashier initiates" — accurate as a category, but by design it cannot distinguish *which* cashier (an agent moving their own player's coins, vs. a superadmin moving an agent's coins) once a specific row is filtered down to just `admin_credit`/`admin_debit`, because — confirmed directly against the live SQL in File 19's investigation — `agent_transfer_coins` writes `admin_credit`/`admin_debit` on the **agent's own** ledger row as a side effect of an agent-initiated player transfer, using the identical `kind` values `admin_issue_coins` uses for genuine superadmin-driven issuance. This file's vocabulary is well-designed and correctly documents the real database enum (verified against the `coin_ledger.kind` CHECK constraint) — the conflation is a schema/RPC-design property this file accurately reflects, not a naming or filtering mistake introduced here. Fixing the display-layer confusion found in Files 7/8/12/18/19/20 would require either a schema change (a finer-grained `kind`, or a column distinguishing the initiating actor) or consistent use of `counterparty_id` at every read site — this file alone cannot resolve it, since it correctly mirrors what the database actually produces.
- All seven `LEDGER_KINDS` values and their sign conventions match every call site already cross-checked in this audit.

---

<a id="file-32"></a>
## File 32 — `src/lib/database.types.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `Json` type, `Database` type (`Tables`: `active_sessions`, `audit_log`, `bets`, `coin_ledger`, `game_config`, `play_limits`, `profiles`, `rounds`; `Functions`: all 15 RPCs listed by name with `Args: Record<string, unknown>` / `Returns: Json`; empty `Views`/`Enums`/`CompositeTypes`).
- **Database & Backend Connections:** this *is* the schema map every other file's typed Supabase client (`lib/supabase.ts`, File 29) is generic over — the mechanical source of the compile-time protection referenced throughout this report.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** A generated (not hand-written — explicitly marked "do not edit by hand," produced by `scripts/gen-db-types.js` against the live schema) TypeScript mirror of every table's row shape, plus a list of every RPC function name with its arguments and return value both typed as opaque (`Record<string, unknown>` / `Json`).
- **Non-Coder:** An auto-generated map of exactly what columns and functions the database actually has right now, so the code editor and compiler can catch a typo'd table/column name before it ever reaches production.

### Section 3: Structure
Pure generated type declarations — no logic.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none (nothing to execute).

**🗑️ Unused / Dead Code** — N/A for a generated schema mirror; every table matches one seen in active use across this audit (`active_sessions`, `audit_log`, `bets`, `coin_ledger`, `game_config`, `play_limits`, `profiles`, `rounds`).

**⚔️ Functionality Conflicts** — none within this file.

**🔗 Mobile App & Database Misalignment — two precise, worth-noting gaps in what this file's own stated protection actually covers:**
- **RPC arguments carry no compile-time protection at all.** Every one of the 15 functions is typed `Args: Record<string, unknown>` — meaning a call like `supabase.rpc('agent_transfer_coins', { p_player_id, p_amount, p_direction })` (File 21) gets **zero** checking that those parameter names or types match the actual SQL function signature. This file's own header comment states its purpose is to turn a wrong-column-name mistake into a compile error — true for table `.select()`/`.eq()` calls, but this coverage does not extend to RPC call arguments, which include some of the highest-stakes operations in the app (coin movement, admin issuance). `lib/rpc.ts` (File 30) separately hand-types RPC *return* shapes, but nothing in the codebase hand-types RPC *argument* shapes — a real, precise gap in an otherwise carefully-built type-safety story, not a bug in this file's generation but a boundary of what generated table types can cover for functions.
- **CHECK-constrained columns are typed as plain `string`, not as the literal unions the rest of the codebase actually expects.** `profiles.role`, `coin_ledger.kind`, and `rounds.phase` are all declared here as bare `string` (the DB enforces their real value sets via CHECK constraints, not native Postgres `ENUM` types, per `DATABASE_AUDIT_REPORT.md` — reflected accurately here as empty `Enums: Record<string, never>`). This is why every consuming file in this audit that narrows one of these fields does so with an unvalidated `as` cast — `profile.role as AppRole` (File 28), `row.kind as LedgerKind` (File 21), `CurrentRound.phase` typed independently and by hand in `lib/rpc.ts` (File 30) rather than derived from this file. None of these casts are checked against this file's `string` type at compile time, and none are validated at runtime — if the DB's CHECK constraint and a hand-written union type (e.g. `AppRole`, `LedgerKind`) were ever to drift apart, nothing here would catch it. This is an accurate reflection of the current schema design choice (CHECK constraints over native enums) rather than a flaw in the generator, but it's the precise reason this codebase relies on manual, unenforced casts at every one of these boundaries instead of the compiler doing that work.

---

<a id="file-33"></a>
## File 33 — `src/lib/utils.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `cn(...inputs: ClassValue[])`, `formatCurrency(amount: number)`.
- **Database & Backend Connections:** none — pure display/styling helpers, used across nearly every component in `src/components/ui/` and every page audited in this report.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** `cn()` is the standard shadcn/ui Tailwind class-merging helper (`clsx` + `tailwind-merge`). `formatCurrency()` wraps `Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })` — Indian-style digit grouping, no currency symbol, up to 2 decimal places (though every value passed to it throughout this codebase is always a whole-number coin count, so no fractional output has actually been observed).
- **Non-Coder:** Two tiny utilities used everywhere — one for combining CSS classes cleanly, one for formatting coin numbers with comma grouping.

### Section 3: Structure
Two one-line pure functions.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none in this file itself.

**🗑️ Unused / Dead Code** — none; both exports are extremely widely used.

**⚔️ Functionality Conflicts**
- **`superadmin/live-game/page.tsx` (File 13) locally redefines its own `formatCurrency` instead of importing this shared one — confirmed by grep across the entire `src/` tree, the only such duplicate found.** File 13's local version (`new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(val) + ' Coins'`) differs from this shared one in two ways: it never allows decimal places (`0` vs `2`) and appends a literal `" Coins"` suffix that no other page in the dashboard adds. Net effect: the exact same underlying coin value displays as `"1,000"` on every other page in the app and `"1,000 Coins"` specifically on the live-game page — a real, user-visible formatting inconsistency, and a second, independently-maintained copy of logic that could drift further from the shared version over time (e.g., if the shared formatter's locale or grouping ever changed, File 13 would silently not follow).

**🔗 Mobile App & Database Misalignment** — N/A, pure display formatting with no backend surface.

---

## Folder-Level Completion Summary — `src/lib/`

### 1. Folder Architecture & Overview
This is the shared foundation every other folder in the dashboard is built on: typed Supabase client factories (`supabase.ts`), the central authorization gate (`auth-guard.ts`), the generated schema mirror they're typed against (`database.types.ts`), a hand-maintained RPC return-shape contract (`rpc.ts`), the coin-ledger vocabulary (`ledger.ts`), and two trivial display helpers (`utils.ts`). Every file here is small, purposeful, and — with one exception — free of the kind of duplication and silent-failure bugs found repeatedly in `src/app/`. This folder reads as the part of the codebase its authors were most careful with, which makes the deviations from it elsewhere (Files 6, 17, 25, 27, 28 all hand-rolling untyped Supabase clients instead of using `createAdminClient()`; File 13 hand-rolling its own `formatCurrency`) stand out clearly as avoidable regressions rather than the norm.

### 2. Folder-Wide Interdependencies
- `supabase.ts` is generic over `database.types.ts`'s `Database` type — the mechanical link that makes the whole "typed client catches column typos" design work, when actually used.
- `auth-guard.ts` depends on `supabase.ts`'s `createClient()` for session resolution but — the one real defect found in this folder — bypasses `createAdminClient()` in favor of its own untyped inline client for the profile lookup.
- `rpc.ts` and `ledger.ts` are both consumed extensively by `src/app/superadmin/` and `src/app/agent/`'s action files; this pass confirmed several of their types directly against the live migration SQL rather than only against the DB audit's summary.

### 3. Folder Bug & Conflict Summary
- **The `createAdminClient()`-bypass pattern, now confirmed in five locations across the whole audit** (Files 6, 17, 25, 27, and — most significantly — 28's `requireAuth()` itself): every one of these hand-builds an untyped inline service-role client instead of using the correctly-typed, centrally-documented one this folder provides. This is the single most repeated, cheaply-fixable pattern found across the entire `bsg_web_dashboard` audit.
- **A precise, previously-unstated gap in the type-safety story:** RPC call arguments (unlike table columns and RPC return shapes) carry no compile-time protection anywhere in the codebase (File 32), and CHECK-constrained string columns require unvalidated manual casts at every read site (File 32) — both accurate reflections of deliberate schema/tooling choices rather than mistakes, but worth knowing as the edges of what this codebase's otherwise-careful type discipline actually covers.
- **One duplicated display helper** (File 33 vs. File 13) causing a minor, cosmetic, but real cross-page formatting inconsistency.
- **Independently reconfirmed, not just inherited:** the ledger-`kind`-conflation issue tracked since the superadmin folder was traced to its precise origin here (File 31) by reading the actual `agent_transfer_coins`/`admin_issue_coins` SQL — confirmed to be a schema/RPC-level property this folder's `ledger.ts` accurately reflects, not a naming mistake anywhere in `src/lib/` itself.

### 4. Positive, Confirmed-Correct Findings
- `auth-guard.ts`'s `requireAuth()` logic itself (setting aside its client-construction style) is fully sound and fails closed at every branch.
- `lib/supabase.ts` is a clean, well-documented reference implementation with no defects.
- `lib/rpc.ts`'s hand-typed RPC return shapes were spot-verified against live SQL and found accurate.
- `lib/ledger.ts`'s vocabulary is well-designed and accurately mirrors the real `coin_ledger.kind` CHECK constraint.
- Every table/column name across all 6 files in this folder matches `DATABASE_AUDIT_REPORT.md`'s documented v2 schema exactly.

Audit for folder `src/lib/` is complete! Please provide the next folder to audit.

---

## Group: `src/components/*`

<a id="file-34"></a>
## File 34 — `src/components/responsive-pagination.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `ResponsivePagination` (default consumer-facing export), `pageWindow()` helper, `ELLIPSIS` constant.
- **Database & Backend Connections:** none — pure UI component, used across nearly every paginated list/table audited in this report (Files 9, 11, 12, 18, 20, 22, 24, and more).

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** A shared pagination control — simplified Prev/Next on mobile, a windowed page-number strip (first/last + a moving window around the current page, collapsed with ellipses) on desktop. Documents its own historical fix (`B-8`): the previous version rendered one button per page via `Array.from({ length: totalPages })`, producing hundreds of buttons for a few hundred records.
- **Non-Coder:** The "Page 1 2 3 … 42" control at the bottom of every table in the dashboard.

### Section 3: Structure
1. `pageWindow()` — builds the set of page numbers to show (all pages if ≤7 total; otherwise first/last/current/neighbors plus edge padding), sorted, with `ELLIPSIS` markers inserted at gaps.
2. Mobile: simplified Prev/Next + "Page X of Y" text.
3. Desktop: Prev arrow, the windowed page-number buttons, Next arrow.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **`pageWindow()` traced through several boundary cases (page 1, a middle page, the last page) by hand — all produced correct, sensible windows** (e.g. `[1,2,3,4,…,100]` at page 1 of 100; `[1,…,49,50,51,…,100]` at page 50; `[1,…,97,98,99,100]` at page 100). No defect found in this function.
- Minor, low-severity cosmetic edge case: if ever rendered with `totalItems === 0`, the desktop info text would read "Showing 1–0 of 0 entries" rather than "0 of 0" — but every call site in this codebase conditionally hides this component entirely when there's nothing to paginate, so this path was not observed to be reachable in practice.

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts** — none; this is the one shared pagination implementation actually reused everywhere rather than duplicated (contrasting favorably with the desktop/mobile row-rendering duplication found throughout `src/app/`).

**🔗 Mobile App & Database Misalignment** — N/A, pure UI, no backend surface.

---

<a id="file-35"></a><a id="file-36"></a>
## File 35-36 — `src/components/theme-provider.tsx` and `src/components/theme-toggle.tsx`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `ThemeProvider` (thin wrapper around `next-themes`'s provider), `ThemeToggle` (the sun/moon icon button).
- **Database & Backend Connections:** none.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** `ThemeProvider` is a one-line pass-through wrapper around the `next-themes` library's provider, used once in the root layout (File 2). `ThemeToggle` uses `React.useSyncExternalStore` with dummy subscribe/snapshot functions purely as a hydration-safe "has the client mounted yet" check (a standard, valid pattern to avoid an SSR/client theme mismatch flashing incorrectly on first paint) before rendering the actual sun/moon toggle button.
- **Non-Coder:** The light/dark mode switch seen throughout the dashboard, built to avoid a jarring flash of the wrong theme when a page first loads.

### Section 3: Structure
Both are small, self-contained, single-purpose components with no branching logic beyond the mount-check.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none found in either file.

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts** — none. Worth noting, not a bug: `ThemeToggle` only cycles between `"dark"`/`"light"` — once a user has toggled away from the root layout's `defaultTheme="system"` (File 2), there's no way back to "follow system" from this button alone. A reasonable, common design choice for a binary toggle, not a defect.

**🔗 Mobile App & Database Misalignment** — N/A.

---

<a id="file-37"></a>
## Files 37-46 — `src/components/ui/*` (button, input, label, card, slider, dialog, popover, select, table, calendar)

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** Standard shadcn-style primitive wrappers around `@base-ui/react` (a Radix-alternative headless component library) — `Button`/`buttonVariants`, `Input`, `Label`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardAction`/`CardContent`/`CardFooter`, `Slider`, `Dialog`/`DialogTrigger`/`DialogContent`/etc., `Popover`/`PopoverTrigger`/`PopoverContent`/etc., `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`/etc., `Table`/`TableHeader`/`TableRow`/`TableCell`/etc., `Calendar`/`CalendarDayButton` (wrapping `react-day-picker`).
- **Database & Backend Connections:** none — pure presentational primitives, styled via Tailwind + `cva` variant definitions, no business logic.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The full shadcn/ui-style component kit these apps are built from — each file follows the identical pattern (a thin, typed wrapper around a headless `@base-ui/react` primitive, styling applied via `cn()`/`cva`). No custom business logic, no data fetching, no state beyond what each headless primitive manages internally.
- **Non-Coder:** The building-block library — buttons, text inputs, popup dialogs, dropdowns, calendars, tables — that every page in the dashboard is assembled from.

### Section 3: Structure
Each file exports one primitive component plus its compositional sub-parts (e.g. `Dialog`/`DialogTrigger`/`DialogContent`/`DialogHeader`/`DialogFooter`), following the same shape throughout.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Resolves a question flagged back in the superadmin folder (File 7/8's RTP slider).** `Slider`'s value contract (lines 13-17: `_values = Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]`) confirms this `@base-ui/react` Slider is array-based — `onValueChange` emits an array of numbers, never a bare number, even for a single-thumb slider (consistent with every call site passing `value={[rtpValue]}` as a one-element array). This confirms that `superadmin/page.tsx`'s (File 7) `onValueChange` handler branch `if (typeof val === 'number') { setRtpValue(val) }` is dead code that can never execute — only the `else if (Array.isArray(val) && ...)` branch actually ever runs. Harmless in practice (the working branch is there), but now confirmed rather than merely suspected.

**🗑️ Unused / Dead Code**
- **`select.tsx`'s entire component surface (`Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`, `SelectGroup`, `SelectLabel`, `SelectSeparator`, `SelectScrollUpButton`/`DownButton`) is never imported anywhere in the codebase** — confirmed by grep for `from '@/components/ui/select'` across all of `src/`, zero matches. Every dropdown observed throughout this entire audit (agent-status filters, agent pickers, type filters) uses a plain native HTML `<select>` element instead. This 200-line file is fully unused, styled boilerplate.
- **`card.tsx`'s compositional sub-parts are almost entirely unused in practice.** Of `CardHeader`/`CardTitle`/`CardDescription`/`CardAction`/`CardContent`/`CardFooter`, only `CardContent`/`CardHeader` were ever even *imported* anywhere (`superadmin/agents/[agentUsername]/page.tsx`, File 11) — and neither actually appears in that file's rendered JSX either (File 11 builds its card interiors from plain `<div>`s instead). Every page in this audit consistently uses bare `<Card className="...">` with hand-built inner markup rather than this file's intended compositional API — not a functional bug, but six of the file's seven exports carry no real usage anywhere in the app.

**⚔️ Functionality Conflicts** — none found; no file in this group diverges from its own established pattern.

**🔗 Mobile App & Database Misalignment** — N/A across all ten files; none have any backend surface.

---

## Folder-Level Completion Summary — `src/components/`

### 1. Folder Architecture & Overview
Two layers: three small, custom, purpose-built components (`responsive-pagination.tsx`, `theme-provider.tsx`, `theme-toggle.tsx`) that carry the folder's only actual logic, and a `ui/` subfolder of ten standard shadcn-style primitives wrapping `@base-ui/react` with no business logic of their own. This is, alongside `src/lib/`, one of the two cleanest folders in the codebase.

### 2. Folder-Wide Interdependencies
- `ui/calendar.tsx` and `ui/dialog.tsx` both depend on `ui/button.tsx` for their internal buttons (calendar nav arrows, dialog close button).
- `responsive-pagination.tsx` depends on `ui/button.tsx`.
- Every custom page audited in `src/app/` depends on some subset of this folder — `Card`/`Table`/`Dialog`/`Input`/`Label`/`Popover`/`Calendar`/`Button` in heavy, consistent rotation; `Select` in none.

### 3. Folder Bug & Conflict Summary
- No functional bugs found anywhere in this folder.
- Two confirmed dead-code findings: `ui/select.tsx` entirely unused; most of `ui/card.tsx`'s compositional sub-components unused in favor of bare `Card` + hand-built `<div>` markup everywhere.
- One confirmed, previously-flagged-as-uncertain finding resolved: the RTP slider's redundant `typeof val === 'number'` branch (File 7) is dead code, now confirmed against the actual `Slider` primitive's array-based value contract.
- `responsive-pagination.tsx`'s windowed-pager logic (`pageWindow()`) was traced through several boundary cases by hand and found correct — a well-built, actually-shared component, in contrast to the desktop/mobile row-rendering duplication found throughout nearly every list view in `src/app/`.

### 4. Positive, Confirmed-Correct Findings
- All three custom components (`responsive-pagination.tsx`, `theme-provider.tsx`, `theme-toggle.tsx`) are clean, correct, and free of the patterns flagged repeatedly elsewhere in this audit.
- The `ui/` primitives are consistent, unmodified-in-spirit shadcn-style boilerplate with no signs of the kind of copy-paste drift or silent-failure patterns found in `src/app/`.

Audit for folder `src/components/` is complete!

---

## Section 47: Consolidated Cross-Codebase Findings

All folders under `bsg_web_dashboard/src/` have now been audited (46 files across `middleware.ts`/`layout.tsx`/`page.tsx`, `superadmin/`, `agent/`, `actions/`, `api/`, `lib/`, `components/`), cross-checked throughout against `DATABASE_AUDIT_REPORT.md` and `bsg_app/AUDIT_REPORT.md`. `supabase/migrations/` and `supabase/functions/round-scheduler` were out of scope (already covered by the DB audit), consulted directly only where needed to verify a specific claim against live SQL.

### Highest-severity findings (ranked)

1. **🔴 CRITICAL — `src/app/api/auth/login/route.ts` (File 25) is a live, unauthenticated authorization bypass, not merely dead code.** Its query against the dropped `profiles.balance` column silently fails and disables the only check in the route that reads the authoritative `profiles.is_active` flag; its other two checks read `user_metadata` fields v2 never populates. Net effect: every authorization check in this route is inert, while the route itself is a public, unauthenticated `POST` endpoint that returns a working Supabase session token for *any* valid credential pair — blocked or not, any role. Confirmed dead from the mobile app's perspective by reading `bsg_app`'s own source comments, but "unused by the intended client" is not "safe" — this is reachable today by anyone who discovers the URL.
2. **🟠 HIGH — The double-entry coin-ledger design (`agent_transfer_coins` writing `admin_credit`/`admin_debit` on the agent's own row) corrupts both a superadmin KPI and agent-facing UI, confirmed against the live RPC SQL.** Concretely: the superadmin dashboard's "Today Issued" KPI (Files 7/8) and the dedicated "Coins Issued Ledger" page's entire premise (File 12) both conflate genuine coin issuance with unrelated agent-player transfer bookkeeping; on the agent side, every player transfer an agent makes appears twice in their own activity feed, once correctly and once as a phantom "SuperAdmin" transaction (Files 18-21). Traced to its precise origin in this pass by reading `agent_transfer_coins`'s and `admin_issue_coins`'s actual SQL bodies, not inferred from the DB audit's summary alone.
3. **🟠 HIGH — `src/app/api/user/profile/route.ts` (File 27) shares File 25's exact defect**, letting a blocked account's still-valid bearer token report `status: 'Active'`. Lower severity than File 25 (can't issue a new session), but the same root cause, independently reachable.
4. **🟡 MEDIUM — Two guaranteed, reproducible (not rare-race) first-load bugs, each traced across a specific pair of files:** `getAgentProfitReportAction` has no username-to-UUID resolution, and `superadmin/agents/[agentUsername]/page.tsx`'s P&L tab calls it with an unresolved username on every initial page load (Files 11/23); the same page's "Live Draw Monitor" scaffolding was fully abandoned in place after the real feature shipped as its own route (Files 7/8/13), while `live-game/page.tsx` separately mislabels a round-ID fragment as a player's `@username` and ignores server-authoritative round-timing data in favor of a hardcoded, drift-prone client-side guess.
5. **🟡 MEDIUM — A systemic, repeated pattern: every list/metrics-fetching action across both portals returns `{ ..., error }` on failure, and nearly every caller ignores it**, checking only data-field truthiness (always true for an object or empty array). A real backend failure anywhere in either portal renders as empty tables/all-zero KPIs, indistinguishable from genuinely empty data. Found in 8+ files (7, 9, 12, 18, 20, 24, and by extension others); `agent/history/page.tsx` (File 20) is the sole exception that captures the error but still never renders it.
6. **🟡 MEDIUM — The `createAdminClient()`-bypass pattern, confirmed in 5 locations, most significantly in `requireAuth()` itself** (Files 6, 17, 25, 27, 28): hand-built, untyped inline service-role clients instead of the correctly-typed, centrally-provided one — the single most repeated, cheaply-fixable pattern in the codebase, concentrated in exactly the authentication-sensitive code paths where the lost compile-time column-checking matters most.
7. **🟡 MEDIUM — A three-way (client/server/DB) username-regex mismatch, confirmed in 3 separate forms/files** (Files 9, 21/22), verified directly against the live migration SQL: the DB and every server action allow underscores in usernames, but three separate client-side create-account forms don't, silently rejecting legitimate usernames the rest of the stack would accept.
8. **🟢 LOW/notable — A broken custom date-range filter on the superadmin's compliance-critical "Coins Issued Ledger" page** (File 12: a zero-width `startDate === endDate` window, always returning empty results), in direct, instructive contrast to three other files in the codebase (`agent/profit/actions.ts`, `agent/history/page.tsx`, `superadmin/actions.ts`) that implement the equivalent IST day-boundary logic correctly.
9. **🟢 LOW — Two account-status information-disclosure issues in the login flows** (Files 6, 17): differentiated error messages let anyone testing known/guessed credentials learn an account's exact role and suspension status once the password is confirmed correct. Every branch still fails closed — disclosure, not bypass.
10. **🟢 LOW/cosmetic — A scattering of small, independently-confirmed typos and dead code**, each verified by direct evidence rather than inference: a `createdAtIso`/`created_at_iso` casing typo silently disabling a filter and a stats toggle (File 22, confirmed via contrast with the working twin in File 11); a `'Superadmin'`/`'SuperAdmin'` capitalization typo defeating a UI check in two files (18, 20); a self-contradicting `if/else if` on an identical condition (File 11); a genuinely unreachable code branch verified against the DB's `role` CHECK constraint (File 17); a locally-reinvented `formatCurrency` causing a cross-page display inconsistency (File 13 vs. 33); an entirely unused `select.tsx` component and mostly-unused `card.tsx` sub-components (Files 37-46, confirmed by grep).

### Systemic patterns worth naming once, since they recur throughout

- **Desktop-table/mobile-card duplication** appears in nearly every list view across both portals — the same data rendered via two independently-maintained, verbatim-duplicated JSX branches, with no shared row/card component (contrasting with `ResponsivePagination`, File 34, which *is* properly shared).
- **The codebase's authors clearly know its own best patterns — they just don't apply them everywhere.** The clearest evidence: `players/actions.ts` (File 21) explicitly justifies its one safe use of a PostgREST embed with a real-foreign-key argument, while `superadmin/actions.ts` (File 8) uses an unjustified one a few dozen lines after warning against exactly that failure mode; `lib/supabase.ts`'s typed clients exist and are well-documented, yet five files bypass them; `agent/profit/actions.ts`'s correct IST day-boundary math exists in the same codebase as `agents/issued/page.tsx`'s broken zero-width window.
- **No test coverage of any kind exists in this project** — no test files, no test framework in `package.json`, no `"test"` script — mirroring `bsg_app/AUDIT_REPORT.md`'s identical finding for the mobile client. Every finding in this report was verified by direct code reading and, where possible, cross-reference against live SQL, precisely because no automated test suite exists to have already caught any of it.

### Confirmed non-issues (positive findings worth keeping visible)
Every table/column name referenced across all 46 files matches `DATABASE_AUDIT_REPORT.md`'s documented v2 schema exactly, with zero naming drift found anywhere in the web dashboard. `middleware.ts`'s and every login flow's role-source design (`app_metadata`, never client-writable `user_metadata`) is fully consistent with the DB audit's S-2 fix. Every coin-moving RPC call in both portals correctly routes through the caller's own session rather than the service-role client, matching the documented privilege model exactly. `requireAuth()`'s own authorization logic fails closed at every branch. The player↔agent↔superadmin role routing between the mobile app and both dashboard portals is coherent and confirmed consistent across all three codebases audited across this session (`bsg_app`, the database, and `bsg_web_dashboard`).

---

---

## Bonus Scope: Root-Level Tooling Scripts

Outside the original `src/` scope, but flagged as worth a look after the main audit: two custom operational scripts (not boilerplate) that neither this report nor `DATABASE_AUDIT_REPORT.md` had covered, plus a quick check of `next.config.ts` for build-time footguns.

<a id="file-47"></a>
## File 47 — `apply_sql_to_live_db.js`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** the script's top-level async IIFE (no exported functions — a standalone CLI tool).
- **Database & Backend Connections:** connects directly to Postgres via the `pg` package (not Supabase's client libraries) using `POSTGRES_URL`/`PG_URL`; applies an arbitrary `.sql` file's contents as one `client.query(sql)` call inside `BEGIN`/`COMMIT`.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** A hardened CLI operator tool for applying one migration file to the live database in a transaction. Its own header comment documents exactly why it was rewritten (`A-6`, `N-0`): the previous version hard-coded the production superuser password in a file not covered by `.gitignore`, always re-ran a full-rebuild script that opens with `DROP TABLE ... CASCADE` on five tables including `profiles`, and ran outside a transaction (so a partial failure left a half-migrated schema behind). This version takes the file as an argument, refuses to run without credentials supplied via environment variable, statically refuses any file containing a destructive statement, and wraps everything in a transaction with rollback on error.
- **Non-Coder:** The tool an operator runs by hand to push one database change to the live system, rebuilt after a near-miss where the old version could have wiped the production database.

### Section 3: Structure
1. Validate: a file argument was given, `POSTGRES_URL`/`PG_URL` is set, the file exists.
2. Read the file; refuse (exit 1) if it matches `/\b(DROP\s+TABLE|DROP\s+SCHEMA|TRUNCATE|DELETE\s+FROM)\b/i`.
3. Connect, `BEGIN`, run the whole file as one query, `COMMIT`; on any error, `ROLLBACK` and report failure instead of leaving a partial change applied.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **TLS certificate verification is disabled (`ssl: { rejectUnauthorized: false }`) on a connection this script's own comments describe as using production superuser-level credentials.** This accepts any certificate the server presents, including a self-signed or attacker-supplied one — the connection is not protected against a network-level machine-in-the-middle, which could observe or tamper with the credentials and the SQL being executed. Everything else about this script's hardening (no hard-coded secrets, destructive-statement refusal, transactional safety) is undermined if the one network hop carrying a superuser Postgres session isn't actually verified to be talking to the real server.
- **The destructive-statement regex guard has a narrow, low-severity gap:** `DROP\s+TABLE` requires literal whitespace between the two words, so an unusually formatted statement (e.g. a SQL comment inserted between `DROP` and `TABLE`) would not match and would not be refused. In this script's actual threat model — a trusted operator accidentally re-running the wrong file — this has limited practical relevance (anyone wanting to bypass their own safety net could simply edit the script or run `psql` directly), but it means the guard is a best-effort accident-prevention net, not a hard technical guarantee, and is worth knowing precisely rather than assuming it's airtight.
- Minor, fails-safe-not-unsafe: the same regex can false-positive on a file that merely *mentions* one of the guarded keywords in a SQL comment (e.g. `-- do not TRUNCATE this table`), refusing a perfectly safe migration. An annoyance, not a safety gap.

**🗑️ Unused / Dead Code** — none; this is a lean, single-purpose script.

**⚔️ Functionality Conflicts** — none.

**🔗 Mobile App & Database Misalignment**
- **Directly corroborates a `DATABASE_AUDIT_REPORT.md` finding from a different angle:** this script's own comment states the codebase's baseline rebuild file (`20260728050000_bsg_fresh_setup.sql`) is stale relative to production ("the live `submit_round_bet` is a single text-signature function carrying `P0009`/`P0010` guards the file does not have") — an independent, first-person confirmation that production and the migration history have drifted apart at least once, consistent with the DB audit's own extensive documentation of the v1→v2 rebuild's messiness.

---

<a id="file-48"></a>
## File 48 — `scripts/gen-db-types.js`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** `tsType()`, `run()` — the generator that produces `src/lib/database.types.ts` (File 32).
- **Database & Backend Connections:** queries `information_schema.columns`/`information_schema.tables` and `pg_proc` directly via `pg`, against the live schema.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** The generator behind File 32, confirming precisely what that file's own header comment claimed. Reads every base-table column (with nullability/default-derived optionality for `Insert` shapes) and every `public`-schema function name into a hand-rolled `Database` type, written to `src/lib/database.types.ts`.
- **Non-Coder:** The tool that keeps the "does this column actually exist" safety net (File 32) up to date with the real database, run by hand after every migration.

### Section 3: Structure
1. Query all base-table columns, grouped by table.
2. Query all `public`-schema functions by name (arguments/return type intentionally not introspected — see below).
3. Emit `Row`/`Insert`/`Update` shapes per table (optional-on-`Insert` when a column has a default or is nullable) and a `Functions` entry per RPC name.
4. Write the result to `src/lib/database.types.ts`.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases**
- **Same TLS-verification gap as File 47** (`ssl: { rejectUnauthorized: false }`) — a second instance of the identical issue, on a script that also connects with elevated database credentials (`PG_URL`).
- **`Relationships` is hardcoded to `[]` for every table, regardless of actual foreign keys — and this is the precise, previously-unexplained root cause of a pattern observed earlier in this audit.** Files 8 and 21 were both observed using embedded/joined `.select()` calls (`rounds!inner(...)`, `bets(..., profiles:user_id(username))`) followed by a manual `as unknown as {...}` cast to access the embedded data, rather than relying on the generated types to know the shape of the join. Now confirmed why: because this generator never populates `Relationships`, the typed client has **no compile-time knowledge of any foreign-key relationship at all**, so every embedded-select call site in the entire codebase is necessarily working around the generator's own gap with an unchecked manual cast — not a stylistic choice by those call sites, but a structural consequence of this file.

**🗑️ Unused / Dead Code** — none in the script itself.

**⚔️ Functionality Conflicts** — none.

**🔗 Mobile App & Database Misalignment**
- **Refines, rather than contradicts, the File 32 finding about untyped RPC arguments.** This generator's own comment is explicit and self-aware about the tradeoff: *"Args are typed loosely: the RPC surface returns jsonb and the call sites validate their own shapes. The value here is that the function NAME is checked, so a renamed RPC fails to compile."* This confirms File 32's gap is a deliberate, documented engineering tradeoff (catch renamed/deleted RPCs, accept that argument shapes aren't checked) rather than an oversight.
- **Minor precision gap, worth noting:** the generated `Functions` type lists every `public`-schema function by name, including ones `DATABASE_AUDIT_REPORT.md` documents as internal-only and explicitly `REVOKE`d from `anon`/`authenticated` (`apply_coin_movement`, `draw_round`, `settle_round`, `verify_ledger_integrity`, plus trigger-only functions like `handle_new_user`). The type system doesn't distinguish "callable by any authenticated client" from "database-internal, permission-revoked" — a developer reading the generated types alone could reasonably but incorrectly assume every listed function is available to call from the app.

---

<a id="file-49"></a>
## File 49 — `next.config.ts`

### Section 1: Functionality & Database/API Map
- **Exact identifiers:** default-exported `nextConfig`.
- **Database & Backend Connections:** none.

### Section 2: Technical Overview & Non-Coder Explanation
- **Technical:** An empty Next.js configuration object — no options set at all.
- **Non-Coder:** The dashboard's build settings file, left at its out-of-the-box defaults.

### Section 3: Structure
Three lines; no configuration.

### Section 4: Deep-Dive Issue & Conflict Audit

**🐛 Bugs & Edge Cases** — none.

**🗑️ Unused / Dead Code** — none.

**⚔️ Functionality Conflicts** — none.

**🔗 Mobile App & Database Misalignment** — N/A.

**Positive, confirmed-correct finding — this was specifically checked for a footgun and found clean:** neither `typescript.ignoreBuildErrors` nor `eslint.ignoreDuringBuilds` is set to `true` here, which are the two flags that would silently let a production build succeed despite TypeScript/ESLint errors. Left at defaults, Next.js's build will fail on either — meaning the type-safety mechanisms found throughout this audit (`lib/database.types.ts`, `lib/rpc.ts`, the typed Supabase clients) are actually enforced at build time, not just decorative. This is exactly the kind of check worth doing even on a three-line file, since the answer could easily have gone the other way.

---

## Bonus Scope Summary

Both custom scripts share the same real finding — **TLS certificate verification disabled on direct, credentialed Postgres connections** (`apply_sql_to_live_db.js`, `scripts/gen-db-types.js`) — a residual gap in otherwise carefully-hardened tooling (the former explicitly rewritten after a documented near-miss). The type generator also turned out to be the precise, previously-unidentified root cause of the manual unsafe casts observed around embedded/joined queries back in Files 8 and 21 (`Relationships: []` always empty), and confirmed that the untyped-RPC-arguments gap noted in File 32 is a deliberate, self-aware tradeoff rather than an oversight. `next.config.ts` was checked specifically for build-error-suppression flags and found clean.

**This concludes the raw codebase audit of `bsg_web_dashboard`.** Combined with the already-completed `DATABASE_AUDIT_REPORT.md` and `bsg_app/AUDIT_REPORT.md`, all three components of the Best Smart Game platform have now been audited end-to-end.
