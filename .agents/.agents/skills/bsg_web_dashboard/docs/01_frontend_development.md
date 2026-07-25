# FRONTEND DEVELOPMENT SPECIFICATION

## 1. Framework & Core Libraries

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 14+ (App Router) | Use Route Groups (§2) to isolate portals without polluting the URL |
| Language | TypeScript, `strict: true` | `noUncheckedIndexedAccess: true` also on — catches undefined array/object access at compile time, common source of runtime bugs in table/pagination code |
| Styling | Tailwind CSS | Tokens sourced from the Design System doc — no ad-hoc hex values in components |
| Components | shadcn/ui (Radix UI primitives) | Copy-in, not npm-installed — components live in `src/components/ui` and are owned/editable by the team |
| Data fetching (initial) | Server Components + `fetch` w/ Next cache tags | SSR the first paint — no client-side spinner for page-1 data |
| Data fetching (live) | TanStack Query (React Query) | Standardize on **one** client library, not SWR-or-React-Query — see §3.6 for why Query wins here |
| Forms | React Hook Form + Zod | Zod schema is the single source of truth, shared between client validation and server action validation (no duplicate rules) |
| Realtime | Supabase Realtime (Postgres CDC) via a thin wrapper hook | Only for balance/points changes and live status — not for every table |
| State (client, non-server) | Zustand (small, scoped stores) | For UI-only state: sidebar collapse, active filters before they hit the URL. Do **not** put server data in it. |
| Testing | Vitest + React Testing Library (unit/component), Playwright (E2E on auth flows + fund transfer flow) | See §8 |
| Linting/formatting | ESLint (`next/core-web-vitals`) + Prettier + `eslint-plugin-tailwindcss` (catches class ordering/typos) | Enforced via pre-commit hook (Husky + lint-staged), not just CI |

**Package manager:** pnpm (faster installs, strict node_modules — prevents phantom dependency bugs in a multi-portal monorepo-style app).

---

## 2. Directory Structure

Route Groups `(superadmin)` and `(agent)` are used instead of plain folders so each portal can carry its **own root layout** (different sidebar, different auth guard) without that segment appearing in the URL, and so a stray shared component doesn't accidentally leak between portals.

```text
src/
├── app/
│   ├── (superadmin)/
│   │   └── superadmin/
│   │       ├── layout.tsx          # Wraps all superadmin routes in the auth guard + shell
│   │       ├── login/
│   │       │   └── page.tsx
│   │       ├── dashboard/
│   │       │   ├── page.tsx
│   │       │   └── loading.tsx     # Skeleton for this route specifically
│   │       ├── agents/
│   │       │   ├── page.tsx        # List (server component, reads ?page ?q ?status)
│   │       │   ├── loading.tsx
│   │       │   └── [agentId]/
│   │       │       └── page.tsx    # Agent detail/edit
│   │       └── system/
│   │           └── page.tsx
│   │
│   ├── (agent)/
│   │   └── agent/
│   │       ├── layout.tsx
│   │       ├── login/
│   │       │   └── page.tsx        # Locked-down: no signup, no forgot-password (§3.1)
│   │       ├── dashboard/
│   │       │   └── page.tsx
│   │       ├── players/
│   │       │   ├── page.tsx
│   │       │   └── loading.tsx
│   │       └── history/
│   │           ├── page.tsx
│   │           └── loading.tsx
│   │
│   ├── api/
│   │   └── [...]/route.ts          # Only for webhooks / third-party callbacks.
│   │                                # Internal mutations use Server Actions, not API routes (§3.5)
│   ├── error.tsx                   # Global error boundary
│   ├── not-found.tsx
│   └── layout.tsx                  # Root layout: fonts, providers (Query, Toast)
│
├── components/
│   ├── ui/                         # shadcn primitives — unmodified except tokens
│   ├── layout/                     # Sidebar, Header, MobileNav, PortalShell
│   └── shared/
│       ├── data-table/             # Generic table: sorting, pagination, column defs
│       ├── stat-card/
│       ├── filter-bar/
│       └── status-badge/
│
├── features/                       # Feature-scoped logic, colocated with its UI
│   ├── agents/
│   │   ├── components/
│   │   ├── actions.ts              # Server Actions (mutations) for this feature
│   │   ├── queries.ts              # Data-fetch functions, typed
│   │   └── schema.ts               # Zod schemas for this feature's forms
│   ├── players/
│   └── transfers/
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # Browser client
│   │   ├── server.ts                # Server client (RSC/Server Actions, cookie-bound)
│   │   └── middleware.ts            # Session refresh helper, used by middleware.ts
│   ├── auth/
│   │   ├── guards.ts                # requireRole(), requireSession() — used in layouts
│   │   └── permissions.ts           # Central permission map (see §3.1.3)
│   ├── utils.ts                     # cn() (tailwind-merge + clsx), formatCurrency, formatDate
│   ├── constants.ts                 # Enums: Role, TransactionType, TransactionStatus
│   └── errors.ts                    # Typed error classes + toApiError() mapper
│
├── hooks/
│   ├── useAuth.ts                   # Reads session from context, never re-fetches per component
│   ├── useDebounce.ts
│   └── useRealtimeBalance.ts
│
├── middleware.ts                    # Route protection at the edge (§3.1.2)
└── types/
    └── database.ts                  # Generated Supabase types (`supabase gen types`) — never hand-written
```

**Rule:** a component only imports from `components/ui`, `components/shared`, or its own `features/<x>` folder — never reaches across into another feature's folder. This keeps the agent portal and superadmin portal decoupled even though they share a codebase.

---

## 3. Key Frontend Features

### 3.1 Authentication & Authorization

This is the highest-risk area of the app (it moves money/points) and gets the most rigor.

#### 3.1.1 Separate Portals
* **Super Admin Portal (`/superadmin`):** Own login, own session cookie scope, own layout.
* **Agent Portal (`/agent`):** Deliberately locked down —
  * **No** "Sign Up" — accounts are provisioned only by a Super Admin from `/superadmin/agents`.
  * **No** "Forgot Password" self-service flow. UI shows static helper text below the login button: *"Forgot your password? Contact your administrator."*
  * Rationale to preserve in code comments: self-service password reset on an agent account is an account-takeover vector in a points/funds system with no email-ownership verification step designed in — removing it is a deliberate security decision, not a missing feature. Do not "helpfully" add it back later without a security review.

#### 3.1.2 Session & Route Protection
Protection happens at **three layers**, not one — never rely on client-side checks alone:
1. **`middleware.ts`** — runs at the edge before any page renders. Reads the Supabase session cookie, redirects unauthenticated requests to the correct portal's `/login` before a single byte of the protected page ships.
2. **Portal `layout.tsx`** — calls `requireRole('agent' | 'superadmin')` server-side. This is the real guard; middleware is a fast-path UX optimization, not the source of truth.
3. **Server Actions / mutations** — every mutation independently re-checks the caller's role and, for transfers, that the actor has authority over the target account (e.g. an agent can only credit/debit *their own* players). Never trust that "they got past the layout" implies "this specific action is authorized."

#### 3.1.3 Roles & Permissions
Central permission map in `lib/auth/permissions.ts` (e.g. `canBlockPlayer`, `canCreateAgent`, `canAdjustBalance`) consumed by both UI (to hide/disable buttons) and Server Actions (to actually enforce). UI-level hiding is a UX courtesy; the Server Action check is the enforcement. Never ship a check in only one place.

### 3.2 Dynamic Pagination & Filtering

* **Page size:** Default 20 rows, capped at 100 (matches the max in the Design System's rows-per-page selector). Never allow an unbounded `?limit=` from the client to reach the database query — clamp server-side.
* **Implementation:** Server-side pagination via URL search params (`?page=2&status=active&q=john`), read in the Server Component with `searchParams`. This makes every list state **shareable, bookmarkable, and back-button-safe** — a bonus over client-only pagination state.
* **Search:** Debounced 300ms client input (`useDebounce`) that writes to the URL via `router.replace` (not `push`, to avoid polluting browser history on every keystroke) with `{ scroll: false }` to prevent jump-to-top on each update.
* **Empty vs. zero-results vs. error:** these are three different UI states and must not be conflated —
  * *Empty* (no data exists yet): friendly first-run illustration + primary CTA ("Add your first agent").
  * *Zero results* (filters too narrow): "No results match your filters" + a "Clear filters" action.
  * *Error* (fetch failed): inline error state with a "Retry" button — never a silent blank table.

### 3.3 Loading States & Skeletons

* Every route with async data gets a co-located `loading.tsx` whose skeleton mirrors the real layout's column widths and row height exactly — a generic gray box causes layout shift when real content arrives; a shape-matched skeleton doesn't.
* **Pagination/filter changes** (not first load) should *not* trigger the route-level `loading.tsx` skeleton — that causes a jarring full-page flash on every click. Use `useTransition` (`isPending`) to dim the existing table (`opacity-60 pointer-events-none`) while the next page streams in, so stale-but-recognizable data stays visible until fresh data arrives.

### 3.4 Toast / Feedback

* `sonner`, mounted once in the root layout.
* **Every mutation resolves to a toast** — success or failure, no silent completions. Match the Design System's semantic colors: success (green), error (red), and use warning (amber) for partial-success cases (e.g. "3 of 5 transfers completed — 2 failed").
* Copy follows the Design System's writing rules (§ "More on writing in design"): plain, active voice, states what happened, e.g. *"Transfer complete — ₹5,000 sent to agent_042"* rather than *"Success."* On failure, state what to do next, not just that it failed: *"Transfer failed — agent balance is insufficient."*

### 3.5 Mutations: Server Actions over API Routes

Use Next.js **Server Actions** for all internal writes (point transfers, blocking a player, editing an agent) rather than hand-rolled `api/` routes:
* Co-located with the feature (`features/transfers/actions.ts`), typed end-to-end with the Zod schema shared with the form.
* Automatically gets progressive enhancement (form works before JS hydrates) and CSRF protection built in.
* Reserve `app/api/` exclusively for things that *must* be a real HTTP endpoint: third-party webhooks (payment provider callbacks), or endpoints consumed by a mobile app if one exists later.

### 3.6 Real-Time Data Strategy

Not everything needs to be a live subscription — decide per data type:
| Data | Strategy |
|---|---|
| Agent/player balance shown in the header | Supabase Realtime subscription (must feel instant — this is the number agents watch most) |
| Transaction/spin history table | Standard fetch + React Query, `staleTime` a few seconds, manual refetch on filter change — a list doesn't need a live socket |
| Dashboard KPI cards | React Query with a background refetch interval (e.g. every 30–60s) — "near real-time" is sufficient and far cheaper than a socket per metric |

Standardizing on **React Query alone** (not SWR) avoids two competing cache layers with different invalidation semantics in the same app — pick one and make Server Action mutations call `queryClient.invalidateQueries()` on success so the UI reflects writes immediately without a manual refresh.

### 3.7 Layout Architecture

* **Sidebar:** Fixed, collapsible-to-icon-rail on desktop (persist collapsed state in a cookie, not localStorage, so the server-rendered first paint already reflects it — no layout jump on hydration). On mobile, becomes a Sheet/Drawer triggered from the top bar hamburger, per the Design System's mobile nav rules.
* **Top Header:** Current user (name, role, avatar/initials), a quick-glance stat (e.g. available balance to distribute for agents), notification bell if applicable, and logout. Sticky on scroll on mobile so actions stay reachable.
* **Portal shell separation:** `(superadmin)` and `(agent)` route groups each render their **own** `PortalShell` — do not build one "smart" shell component with `if (role === ...)` branching scattered through it. Two thin, boring, separate shells are easier to reason about and audit than one shell with conditional security-adjacent UI.

---

## 4. Data & Type Safety

* Database types are **generated**, never hand-written: `supabase gen types typescript --linked > src/types/database.ts`, re-run whenever the schema changes, committed to git so CI can diff-check it's not stale.
* Every Server Action's input is validated with the Zod schema from the matching `features/<x>/schema.ts` — reject and return a typed field-level error, never trust client-side validation alone (it's a UX nicety, not a security boundary).
* Money is handled as **integers (smallest unit, e.g. paise/cents)** end-to-end in the DB and business logic; formatted to display currency only at the last moment in the UI (`formatCurrency` in `lib/utils.ts`). Never do float arithmetic on money client- or server-side.

---

## 5. Performance Budget

* **Server Components by default.** A component only becomes `"use client"` when it needs interactivity (state, effects, event handlers) — not because it's convenient. Push `"use client"` as far down the tree ("leaf" components) as possible so the rest stays server-rendered.
* Target Core Web Vitals on 3G/low-end Android profile (this app is explicitly used by agents on mobile, per §3.2's "buttery smooth on low-end mobile" goal): **LCP < 2.5s, INP < 200ms, CLS < 0.1.**
* `next/image` for all raster assets (agent avatars, uploaded documents) — no plain `<img>`.
* Route-level code splitting is automatic via the App Router; additionally lazy-load (`next/dynamic`) anything heavy and non-critical-path, e.g. a charting library on the dashboard, so it doesn't block the login/table interaction paths.

---

## 6. Error Handling

* `app/error.tsx` (and a portal-scoped one per route group) catches render errors with a friendly fallback + "Try again" — never a raw stack trace or Next.js default error screen in production.
* Server Actions return a discriminated union (`{ success: true, data } | { success: false, error: string, fieldErrors？ }`) rather than throwing across the server/client boundary — the calling component always has a typed, predictable shape to branch on.
* All caught errors are logged to the monitoring tool (Sentry or equivalent) with the user's role and route attached, but **never** log full request payloads for money-transfer actions (avoid persisting sensitive financial data in third-party log tooling).

---

## 7. Naming & Code Conventions

* Files: `kebab-case.tsx` for files, `PascalCase` for the component/export inside.
* Server Actions: verb-first, e.g. `transferPoints`, `blockPlayer`, `createAgent` — the name alone should tell a reviewer it's a mutation.
* Booleans: `is/has/can` prefix (`isLoading`, `canApprove`) — never a bare adjective.
* No default exports for components (named exports only) — improves refactor-safety and autocomplete across the large multi-portal codebase.

---

## 8. Testing Strategy

| Layer | Tool | Coverage target |
|---|---|---|
| Unit (utils, formatters, permission map) | Vitest | Pure logic — especially `formatCurrency` and any balance math |
| Component | React Testing Library | Shared components (`data-table`, `filter-bar`, `status-badge`) — test behavior, not implementation |
| E2E | Playwright | The flows where a bug costs money or trust: agent login lockout behavior, point transfer (including insufficient-balance rejection), player block/unblock |

CI blocks merge on: type-check (`tsc --noEmit`), lint, unit/component tests, and the E2E auth + transfer suite. E2E for every minor page is not required — reserve Playwright for flows with real financial/security consequence, per the table above.
