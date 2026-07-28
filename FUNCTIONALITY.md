# BSG Web Dashboard — Complete Functionality & Architectural Catalog
> **Status:** Full Codebase Audit Completed
> **Codebase:** `bsg_web_dashboard`
> **Target Database:** Supabase (`20260728050000_bsg_fresh_setup.sql`)

---

## MODULE 1: CORE UTILITIES & MIDDLEWARE

### 1.1 Class Name Merger (`cn`)
- **File:** `src/lib/utils.ts`
- **Description:** Utility function combining `clsx` and `tailwind-merge` for conditional CSS class joining and Tailwind class deduplication.
- **Usage Example:**
  ```ts
  import { cn } from '@/lib/utils'
  const buttonClass = cn('px-4 py-2 bg-blue-500', isSelected && 'bg-blue-700')
  ```
- **Supabase Dependency / Limitations:** None.

---

### 1.2 Indian Currency Formatter (`formatCurrency`)
- **File:** `src/lib/utils.ts`
- **Description:** Formats raw numbers into Indian locale currency strings (`en-IN`) with up to 2 decimal places.
- **Usage Example:**
  ```ts
  formatCurrency(15000.5) // Returns "15,000.50"
  ```
- **Audit Finding / Risk:** Lacks null/undefined fallback check. Passing `null` or string will output `NaN` or throw a `TypeError`. Needs `Number(amount || 0)` sanitization.

---

### 1.3 Server-Side Supabase Client Factory (`createClient`)
- **File:** `src/lib/supabase.ts`
- **Description:** Instantiates a `@supabase/ssr` server client using Next.js `cookies()` store, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Used in Server Components and Route Handlers for user-authenticated DB operations.
- **Usage Example:**
  ```ts
  const supabase = await createClient()
  const { data } = await supabase.from('profiles').select('*')
  ```
- **Supabase Dependency / Limitations:** Relies on Supabase Auth cookies (`sb-<project-id>-auth-token`). Subject to Supabase connection pool limits on free tier (max 60 pooler connections).

---

### 1.4 Middleware Route Protection (`middleware`)
- **File:** `src/middleware.ts`
- **Description:** Intercepts Next.js requests to protect `/superadmin/*` and `/agent/*` routes. Redirects root `/` to `/agent/login`.
- **Usage Example:**
  - Visiting `/superadmin` without a valid session cookie redirects to `/superadmin/login`.
  - Visiting `/agent/history` with `mock_session=agent` cookie allows navigation.
- **Critical Security Audit Finding:** Route protection currently checks a client-modifiable plain cookie `mock_session` (`session !== 'superadmin'`). **Security Vulnerability:** Anyone can bypass middleware route guards by manually setting `document.cookie = "mock_session=superadmin"`. Middleware MUST be upgraded to validate actual Supabase Auth JWT session tokens.

---

## MODULE 2: PUBLIC REST API ENDPOINTS

### 2.1 Mobile Auth Login (`POST /api/auth/login`)
- **File:** `src/app/api/auth/login/route.ts`
- **Description:** Authentication endpoint for mobile game app clients (`bsg_app`). Accepts `username` & `password`, constructs full email (`username@bestsmartgame.com`), signs in via Supabase Auth `signInWithPassword`, verifies player role and `is_active` status, and fetches real-time balance from `public.profiles`.
- **Usage Example:**
  - **Request:** `POST /api/auth/login` `{"username": "player1", "password": "pass"}`
  - **Response (200 OK):**
    ```json
    {
      "token": "eyJhbGciOi...",
      "user": {
        "id": "uuid-here",
        "username": "player1",
        "name": "player1",
        "balance": 5000,
        "agentName": "agent_alpha",
        "status": "Active"
      },
      "sessionStartAt": "2026-07-28T19:00:00.000Z"
    }
    ```
- **Dependencies & DB Alignment:** Checks `public.profiles` (`balance`, `is_active`). Requires `SUPABASE_SERVICE_ROLE_KEY` to resolve `agent_id` metadata.

---

### 2.2 Mobile Auth Logout (`POST /api/auth/logout`)
- **File:** `src/app/api/auth/logout/route.ts`
- **Description:** Acknowledgment endpoint for mobile player logouts.
- **Usage Example:** `POST /api/auth/logout` → `{ "success": true, "message": "Logged out successfully" }`

---

### 2.3 User Profile & Balance Query (`GET /api/user/profile`)
- **File:** `src/app/api/user/profile/route.ts`
- **Description:** Accepts a `Bearer <token>` HTTP header, validates user JWT with Supabase `auth.getUser()`, and returns live balance, account status, and username from `public.profiles`.
- **Usage Example:**
  - **Request:** `GET /api/user/profile` `Headers: { Authorization: "Bearer <token>" }`
  - **Response (200 OK):**
    ```json
    {
      "id": "uuid-here",
      "username": "player1",
      "name": "player1",
      "balance": 5000,
      "status": "Active"
    }
    ```
- **Dependencies & DB Alignment:** Queries `public.profiles` (`balance`, `is_active`, `username`). Rejects blocked users (`is_active = false`) with 403.

---

## MODULE 3: ROOT APP & LAYOUT COMPONENTS

### 3.1 Root HTML Layout (`RootLayout`)
- **File:** `src/app/layout.tsx`
- **Description:** Sets up font variables (DM Sans), metadata title/description, hydration suppressions, and wraps the app with `ThemeProvider` for dark/light mode toggling.

---

### 3.2 Landing Page (`Home`)
- **File:** `src/app/page.tsx`
- **Description:** Default Next.js boilerplate template page. Auto-redirected to `/agent/login` by `middleware.ts`.

---

## MODULE 4: AGENT AUTHENTICATION & CORE CASHIER PORTAL

### 4.1 Agent Server Login (`agentLogin`)
- **File:** `src/app/agent/login/actions.ts`
- **Description:** Server action handling agent authentication form submission. Appends `@bestsmartgame.com` to username, signs in via Supabase Auth `signInWithPassword`, and sets `mock_session=agent` cookie.
- **Usage Example:** `formData: username="agent1", password="xxx"` → redirects to `/agent`.
- **Critical Security Audit Finding:** Missing role validation! Any player account (`role === 'player'`) can log in here and obtain access to the Agent Back Office. **Fix:** Must check `profiles.role` or `user_metadata.role === 'agent' | 'superadmin'`.

---

### 4.2 Agent Login Interface (`AgentLogin`)
- **File:** `src/app/agent/login/page.tsx`
- **Description:** Client UI component rendering the Agent Back Office sign-in card with brand header, password visibility toggle, and error alert feedback.

---

### 4.3 Agent Dashboard Server Data Fetcher (`getAgentDashboardDataAction`, `getAgentTransactionHistoryAction`)
- **File:** `src/app/agent/actions.ts`
- **Description:** Server actions fetching agent wallet balance, player count, today's wager/win totals, and cashier activity logs.
- **Usage Example:** `getAgentDashboardDataAction()` returns `{ balance: 10000, playersCount: 5, todaysBets: 2000, todaysWins: 1500, todaysProfitLoss: 500, recentTransactions: [...] }`.
- **Audit Finding & Database Alignment:**
  1. Queries legacy `game_history` table for today's bets. Needs update to query `triple_chance_bets` joined with `profiles.agent_id`.
  2. Queries legacy `agent_coin_transactions` table. Needs update to query unified `transactions` table (`type = 'agent_topup' | 'agent_deduct'`).

---

### 4.4 Agent Portal Navigation Shell (`AgentLayout`)
- **File:** `src/app/agent/layout.tsx`
- **Description:** Navigation shell providing a desktop sidebar (w-52) with links to Cashier (`/agent`), Players (`/agent/players`), P&L Report (`/agent/profit`), and History (`/agent/history`). Includes mobile header and floating glassmorphic bottom navigation bar.

---

### 4.5 Agent Cashier Dashboard (`AgentDashboard`)
- **File:** `src/app/agent/page.tsx`
- **Description:** Main Agent Cashier UI. Displays 5 KPI metrics (Available Coins, My Players, Today's P/L, Today Bets, Today Wins), Quick Coin Transfer widget (select player, enter amount, quick preset buttons +100, +500, +1000, +5000, Quick Deposit / Quick Withdraw), and Recent Coin Transfers activity feed with search and type filter.

---

### 4.6 Cashier Transaction History Log (`HistoryPage`)
- **File:** `src/app/agent/history/page.tsx`
- **Description:** Full transaction audit log page. Displays total volume, total deposited, total withdrawn, search input, type filter (Deposit/Withdraw), date preset filters (Today, 7D, 30D, Lifetime), responsive desktop table, and mobile cards feed.

---

## MODULE 5: AGENT PLAYER NETWORK MANAGEMENT

### 5.1 Player Network Server Actions (`getPlayersAction`, `createPlayerAction`, `togglePlayerStatusAction`, `getPlayerDetailHistoryAction`, `resetPlayerPasswordAction`)
- **File:** `src/app/agent/players/actions.ts`
- **Description:** Server actions for managing agent-assigned player accounts:
  - `getPlayersAction`: Fetches profiles where `agent_id = callerAgentId`, cross-references `active_sessions` for online state (< 60s last seen).
  - `createPlayerAction`: Validates username (`/^[a-zA-Z0-9]{3,20}$/`), creates Supabase Auth user with email `username@bestsmartgame.com` and metadata (`role: 'player'`, `agent_id`), and upserts `profiles` row.
  - `togglePlayerStatusAction`: Blocks or activates player. **Security Enforcement**: Confirms caller agent owns player (`agent_id === callerUser.id`).
  - `getPlayerDetailHistoryAction`: Retrieves player's game round bets from `triple_chance_bets` joined with `triple_chance_rounds`, and cashier transactions from `transactions`.
  - `resetPlayerPasswordAction`: Allows assigned agent to reset player's password (min 6 chars).
- **Audit Finding & Optimization:** `togglePlayerStatusAction` currently updates Auth `user_metadata.status`. **Fix**: Must also update `profiles.is_active` boolean directly to trigger mobile app real-time 25s session block.

---

### 5.2 Agent Player Management UI (`PlayersPage`)
- **File:** `src/app/agent/players/[[...slug]]/page.tsx`
- **Description:** Interactive player list and slide-out player detail drawer. Features search, online indicator badges, Create Player modal with live username validation, performance metrics (Total Bet, Total Win, Net GGR, House Margin %), Deposit/Withdraw actions, Password Reset dialog, expandable board bet breakdowns (Single, Double, Triple), and cashier history log.

---

## MODULE 6: AGENT PROFIT & LOSS REPORTING

### 6.1 Agent P&L Server Analytics (`getAgentProfitReportAction`)
- **File:** `src/app/agent/profit/actions.ts`
- **Description:** Server action calculating net profit & loss statistics for an agent's assigned players across custom date presets (Today, 7D, 30D, Lifetime, or Custom Date). Calculates Today's P/L (reset at 00:00:00 IST Asia/Kolkata), Lifetime P/L, Total Wagered (Coins In), Total Payouts (Coins Out), House Margin %, and per-player breakdown.
- **Usage Example:** `getAgentProfitReportAction({ datePreset: 'today' })`

---

### 6.2 Agent P&L Report UI (`AgentProfitPage`)
- **File:** `src/app/agent/profit/page.tsx`
- **Description:** Visual financial analytics interface. Displays 5 summary KPI cards, preset filter pills, custom date calendar picker, player username search input, and paginated player P/L table showing wagered coins, wins returned, net P/L (+/-), and margin %.

---

## MODULE 7: SUPERADMIN AUTHENTICATION & GOD MODE OVERVIEW

### 7.1 Superadmin Server Login (`superAdminLogin`)
- **File:** `src/app/superadmin/login/actions.ts`
- **Description:** Server action handling Superadmin sign-in. Appends `@bestsmartgame.com` to username and sets `mock_session=superadmin` cookie.
- **Critical Security Audit Finding:** Missing role check! Must verify `profiles.role === 'superadmin'` or `user_metadata.role === 'superadmin'` to prevent non-superadmin accounts from logging in.

---

### 7.2 Superadmin Login Interface (`SuperAdminLogin`)
- **File:** `src/app/superadmin/login/page.tsx`
- **Description:** Client UI card for Superadmin God Mode access with glowing brand strip and password visibility toggle.

---

### 7.3 System Overview & Audit Actions (`logAuditEventAction`, `getAuditLogsAction`, `getSystemOverviewMetricsAction`, `getRtpAction`, `updateRtpAction`, `getLatestGameDrawsAction`)
- **File:** `src/app/superadmin/actions.ts`
- **Description:** Server actions for platform-wide metrics and configuration:
  - `logAuditEventAction` & `getAuditLogsAction`: Writes and reads persistent administrative audit events in `public.audit_log`.
  - `getSystemOverviewMetricsAction`: Aggregates total system coins, active agents count, active players count, today's coins issued, lifetime wagers & wins, and today's IST wagers & wins.
  - `getRtpAction` & `updateRtpAction`: Reads and updates target house RTP percentage (`agent_configs.rtp_percentage`).
  - `getLatestGameDrawsAction`: Retrieves real-time round outcome telemetry across all active game rounds.

---

### 7.4 Superadmin Portal Navigation Shell (`SuperAdminLayout`)
- **File:** `src/app/superadmin/layout.tsx`
- **Description:** Navigation shell providing a desktop sidebar (w-52) with links to Overview (`/superadmin`), Live Monitor (`/superadmin/live-game`), and Agents (`/superadmin/agents`). Includes mobile floating bottom navigation bar.

---

### 7.5 Superadmin Overview Dashboard (`SuperAdminDashboard`)
- **File:** `src/app/superadmin/page.tsx`
- **Description:** Main God Mode Dashboard UI. Features 6 top KPI metric cards, System Target RTP slider control (90% - 99% adjustment + save), Audit Log activity feed, and live draw telemetry stream.

---

## MODULE 8: SUPERADMIN AGENT FLEET MANAGEMENT & LIVE TELEMETRY

### 8.1 Agent Fleet Server Actions (`getAgentsAction`, `getAgentDetailAction`, `createAgentAction`, `transferPointsAction`, `getAgentCoinTransactionsAction`, `toggleAgentStatusAction`, `updateAgentPasswordAction`)
- **File:** `src/app/superadmin/agents/actions.ts`
- **Description:** Server actions managing the entire agent network:
  - `getAgentsAction`: Fetches list of agents (`profiles.role = 'agent'`).
  - `createAgentAction`: Creates Agent Auth user with email `username@bestsmartgame.com`, metadata (`role: 'agent'`), and upserts `profiles` row.
  - `transferPointsAction`: Handles coin allocations (Issue coins to Agent from Superadmin, or Transfer coins between Agent and assigned Player).
  - `getAgentCoinTransactionsAction`: Queries cashier transactions history.
  - `toggleAgentStatusAction`: Cascading Agent Block — blocking an agent automatically cascades and blocks all player accounts under that agent.
  - `updateAgentPasswordAction`: Allows superadmin to change any agent's password.

---

### 8.2 Agent Directory (`AgentsPage`) & Coin Issuance Log (`AgentCoinIssuancePage`)
- **Files:** `src/app/superadmin/agents/page.tsx` & `src/app/superadmin/agents/issued/page.tsx`
- **Description:** Agent fleet management UI. Allows superadmin to create agents, issue/withdraw coins, block/unblock agents (with cascading player block confirmation), and inspect complete coin issuance ledgers.

---

### 8.3 Agent Profile & Player Roster (`AgentDetailPage`)
- **File:** `src/app/superadmin/agents/[agentUsername]/page.tsx`
- **Description:** Dedicated detail page for an individual agent showing their total balance, assigned player roster, coin issuance history, and password management tools.

---

### 8.4 Live Game Telemetry & Draw Outcome Monitor (`SuperAdminLiveGamePage`)
- **File:** `src/app/superadmin/live-game/page.tsx`
- **Description:** 24/7 real-time global round outcome monitor. Features 103s round cycle countdown, color-coded Red (1st), Green (2nd), Black (3rd) 3-digit outcome display, player wager/win stats, horizontal recent draws carousel, and searchable global draw history ledger.

---

## MODULE 9: UI COMPONENT LIBRARY

- **Files:** `src/components/responsive-pagination.tsx`, `src/components/theme-provider.tsx`, `src/components/theme-toggle.tsx`, `src/components/ui/*` (Button, Calendar, Card, Dialog, Input, Label, Popover, Select, Slider, Table)
- **Description:** Modular UI design system using Tailwind CSS and Radix UI primitives. Includes theme switching (dark/light), custom pagination controls, form inputs, dialog modals, calendar pickers, and responsive table styling.
