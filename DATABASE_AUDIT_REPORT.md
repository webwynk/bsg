# BSG Database Audit Report

**Scope:** `bsg_web_dashboard/supabase/migrations/` (13 files, ~3,464 lines, chronological)
**Method:** Raw, file-by-file SQL analysis cross-referenced against actual call sites in `bsg_app` (Flutter mobile client) and `bsg_web_dashboard/src` (Next.js dashboard). No packaged audit checklists or skill files were used — every finding below is derived directly from reading the migration SQL and, where relevant, the application code that calls it.
**Auditor role:** Database engineering / Supabase security audit — structural analysis and issue detection only. No replacement SQL or fixes were written as part of this audit.

---

## Table of Contents

1. [Executive Summary — Findings Ranked by Severity](#executive-summary)
2. [File 1 — `20260728050000_bsg_fresh_setup.sql`](#file-1)
3. [File 2 — `20260806120000_fix_rtp_timing.sql`](#file-2)
4. [File 3 — `20260806123000_ledger_version_and_constraints.sql`](#file-3)
5. [File 4 — `20260807000000_rebuild_v2_schema.sql`](#file-4)
6. [File 5 — `20260807000100_rebuild_v2_rls.sql`](#file-5)
7. [File 6 — `20260807000200_rebuild_v2_functions.sql`](#file-6)
8. [File 7 — `20260807001000_role_in_app_metadata.sql`](#file-7)
9. [File 8 — `20260807110000_place_bet_current_round_guard.sql`](#file-8)
10. [File 9 — `20260807120000_round_scheduler.sql`](#file-9)
11. [File 10 — `20260807130000_fix_draw_round_gen_random_bytes.sql`](#file-10)
12. [File 11 — `20260807140000_pending_rounds_index.sql`](#file-11)
13. [File 12 — `20260807150000_fix_draw_round_rtp_reservoir_sampling.sql`](#file-12)
14. [File 13 — `20260807160000_set_draw_at_second_90.sql`](#file-13)

---

<a id="executive-summary"></a>
## Executive Summary — Findings Ranked by Severity

### 🔴 CRITICAL

1. **Blocked (`is_active = false`) agent/superadmin accounts can still transfer and mint coins** — `agent_transfer_coins()` and `admin_issue_coins()` (File 6) both authorize via `SELECT role INTO v_role FROM profiles WHERE id = v_caller AND is_active`. When the caller's account is deactivated, this returns `NULL` (no matching row), and PL/pgSQL treats `IF NULL THEN` as false — **the authorization check silently does not fire**, and the function proceeds as if the caller were a legitimate, active agent/superadmin. `admin_issue_coins` is, by the migration's own description, *"the only function that can increase the total money in the system"* — this bug allows unlimited coin creation from a blocked account. Confirmed reachable: the dashboard's "block agent" action (File 7 audit) only sets `is_active = false` and does not invalidate the account's session, and both RPCs are directly callable via `authenticated`-role `EXECUTE` grants independent of the Next.js app (the app's own `requireAuth()` guard is correctly implemented, but does not protect the database API surface itself — see File 5's own invariant: *"a client cannot move coins by talking to PostgREST directly, no matter what key it holds"*).
   — **Location:** File 6, `agent_transfer_coins` / `admin_issue_coins`.

2. **`draw_round` deterministically favored low-index outcomes (effectively always `'000'`) for every round with any stake, from initial v2 deployment (File 6) until File 12.** The RTP-optimizing scan used strict `<` comparison with no tie-break, so whichever combination tied for "best" first in iteration order (starting at `0,0,0`) won by default, regardless of how many other combinations were equally good. For realistic bet distributions this meant the vast majority of rounds with real money on them produced a biased, non-random, effectively predictable-toward-low-numbers result — not merely a statistical skew but, per File 12's own header, an outcome that was **"always"** the same combination. Fixed in File 12 via reservoir sampling. Historical round outcomes drawn in this window are worth reviewing for financial/fairness reconciliation — this cannot be fixed retroactively by SQL.
   — **Location:** File 6 (introduced), fixed File 12.

### 🟠 HIGH

3. **Guaranteed-win exploit via stale/past round IDs in the original v1 schema** — `submit_round_bet` (File 1) validated only the *current wall-clock position* within a cycle, never that the target round was actually the live one. Combined with `triple_chance_rounds` being publicly readable and `get_my_round_result` having no time/freshness check at all, a client could read an already-settled round's winning digits and bet on them retroactively for a guaranteed payout. **Confirmed fixed** in the v2 rebuild (File 6: `place_bet` checks `red IS NOT NULL`; File 8 adds a third guard requiring the round's own `round_number` to equal the live clock's current round number — the strongest form of this fix).
   — **Location:** File 1 (introduced/legacy), fixed File 6 and hardened File 8.

4. **Privilege escalation via client-controlled signup metadata in v1** — `handle_new_user` (File 1) read `role` and `agent_id` directly from client-suppliable `raw_user_meta_data`, allowing any caller of the Auth signup endpoint to self-assign `role: 'agent'` (or attach themselves to an arbitrary agent). **Confirmed fixed** in File 6: role is hard-clamped to `agent`/`player` only (superadmin can never be created via signup), and account creation was also confirmed (via code cross-reference) to go exclusively through `createAdminClient().auth.admin.createUser()` in trusted dashboard server actions — there is no self-service signup path in `bsg_app` at all.
   — **Location:** File 1 (legacy, superseded), fixed File 6.

5. **`game_config_draw_at_second_check` constraint widened from `[91,102]` to `[85,102]` (File 13), removing the schema-level guarantee that the draw always happens strictly after betting closes.** Compounding this: since File 6's rebuild, `place_bet`'s bet-acceptance cutoff and `get_current_round`/`tick_rounds`' draw-trigger threshold both read the *same* `game_config.draw_at_second` value (unlike the original File 2 design, which used two independent constants with a deliberate 1-second safety margin). The dedicated safety margin File 2 was built to guarantee no longer structurally exists — it depends entirely on whichever value is configured, and the schema no longer enforces the "strictly after" invariant its own File 4 comment claims.
   — **Location:** Architecture change in File 6, constraint loosened in File 13.

### 🟡 MEDIUM

6. **`admin_credit`/`admin_debit` ledger-`kind` values are semantically overloaded.** `agent_transfer_coins` writes them for an agent's own balance side-effect of a player transfer; `admin_issue_coins` writes the *same two values* for a superadmin directly funding/withdrawing an agent (new money entering/leaving the system). Any report filtering `coin_ledger WHERE kind IN ('admin_credit','admin_debit')` cannot distinguish these two very different real-world events.
   — **Location:** File 6.

7. **Modulo bias in CSPRNG digit generation, unaddressed as of the last migration.** `get_byte(gen_random_bytes(1), 0) % 10` (zero-stake fallback, Files 6/10/12) biases digits 0–5 (26/256) slightly over 6–9 (25/256). A smaller instance of the same class of bias was also introduced by File 12's own tie-break fix (`v_rnd % v_tied_count` over a 65,536-value range — much smaller magnitude, but present).
   — **Location:** Files 6, 10, 12 (unaddressed through File 13).

8. **Unvalidated bet keys could crash round resolution in v1** — `submit_round_bet` (File 1) validated bet *values* but not *keys*; a non-numeric key in bet JSONB would throw an uncaught cast exception inside `calculate_round_rtp_outcome`, aborting round resolution for every player in that round. **Confirmed fixed** in File 6: `place_bet` regex-validates every key's exact format before storage.
   — **Location:** File 1 (legacy), fixed File 6.

9. **No per-round fault isolation in the cron scheduler.** `tick_rounds()` (File 9) calls `draw_round`/`settle_round` for up to 20 overdue rounds per tick with no per-iteration exception handling. A single problematic round would abort the entire batch, retry-fail every 10 seconds indefinitely, and block every other overdue round behind it — with no logging of the failure.
   — **Location:** File 9.

10. **Two orphaned web-dashboard API routes reference a column dropped in the v2 schema.** `src/app/api/user/profile/route.ts` and `src/app/api/auth/login/route.ts` both query `profiles.balance`, which was renamed to `coin_balance` in File 4. The login route is self-documented in its own header as a "DEAD ENDPOINT — RECOMMENDED FOR DELETION"; the profile route carries no such note but appears equally unreferenced by any live call site.
   — **Location:** Cross-referenced during Files 4–5 audit; app-code issue, not a migration defect.

### 🔵 LOW / INFORMATIONAL

11. Inconsistent Postgres error codes in v1 (`P0001` meant different things in different functions) — **fully resolved** in v2 (File 6), which introduced a clean, consistent `P01xx` range that matches `bsg_app`'s `api_contract.dart` `ErrCode` class exactly.
12. `REVOKE ... FROM anon, authenticated` (File 5) is a point-in-time statement, not a standing default — any future new table needs the same treatment repeated, or a project-level `ALTER DEFAULT PRIVILEGES`.
13. Missing index on `profiles.agent_id` in v1 (File 1) — **confirmed fixed** in File 4 (`idx_profiles_agent`, partial index).
14. JWT `app_metadata.role` staleness after a role change (File 7) can leave a demoted/blocked user passing the *page-route* middleware gate for up to the JWT's remaining TTL — but confirmed to not affect actual server actions, which independently re-verify via `requireAuth()` against live `profiles` data.
15. Round/bet-level financial aggregates (`rounds.total_stake`/`total_payout`) have no trigger or constraint tying them to the sum of underlying `bets` rows (File 4) — a discipline requirement on the functions maintaining them, not schema-enforced.
16. Stale documentation comments in `bsg_app` referencing removed v1 identifiers (`submit_round_bet`, errcode `P0007`) — comments only, no functional impact.

---

<a id="file-1"></a>
## File 1 — `20260728050000_bsg_fresh_setup.sql`

> **Header warning (in the file itself):** marked "STALE BASELINE — DO NOT RE-RUN AGAINST PRODUCTION." Production had already diverged and hardened beyond this file by the time of this audit. Audited as historical/structural reference per audit scope.

### Section 1: Database Objects & Schema Map

**Tables (8):**
| Table | Key Columns | Constraints |
|---|---|---|
| `profiles` | `id` (PK→auth.users), `username` (UNIQUE), `role` (CHECK player/agent/superadmin), `balance` (CHECK ≥0), `ledger_version`, `is_active`, `agent_id` (self-FK) | |
| `active_sessions` | `user_id` (PK, FK→profiles), `session_token`, `last_seen_at` | single-session enforcement |
| `transactions` | `id`, `user_id`/`agent_id` (FK), `game_name`, `type`, `amount`, `balance_after` | no CHECK on `type`/`game_name` |
| `triple_chance_rounds` | `id`, `round_number` (UNIQUE), `status` (CHECK betting/spinning/complete), `red`/`green`/`black` (CHECK 0-9) | |
| `triple_chance_bets` | `id`, `round_id`+`user_id` (UNIQUE), 3× JSONB bet maps, `total_stake`, win columns, `is_resolved` | |
| `play_limits` | `id` (PK, default `'global'`), min/max per bet type | singleton by convention only |
| `audit_log` | `id`, `type`, `detail` | no producer defined anywhere in this file |
| `agent_configs` | `id` (PK `'global_system_config'`), `agent_id`, `rtp_percentage`, `target_win_percentage` | singleton by convention only |

**Indexes:** `idx_transactions_user`, `idx_transactions_game`, `idx_tc_rounds_number`, `idx_tc_rounds_status`, `idx_tc_bets_user`, `idx_tc_bets_round`.

**Functions/RPCs (18):** `check_and_update_login_session`, `update_user_heartbeat`, `clear_user_session`, `get_play_limits`, `calculate_round_rtp_outcome`, `get_current_round`, `resolve_round_payouts`, `get_recent_rounds`, `submit_round_bet` (×2 overloads: UUID and TEXT), `get_my_round_result`, `handle_new_user`, `get_my_role`, `get_my_agent_id`, `agent_topup_player`, `agent_deduct_player`, `get_my_players`, `toggle_player_active`, `transfer_coins_agent_to_player`, `withdraw_coins_player_to_agent`, `issue_agent_coins`. All `SECURITY DEFINER`, all set `search_path = public`.

**Trigger:** `on_auth_user_created` (AFTER INSERT ON `auth.users`) → `handle_new_user()`.

**App & Dashboard Connections (verified via grep):**
- `bsg_app` calls `submit_round_bet`, `get_current_round`, `get_my_round_result`, `check_and_update_login_session`, `update_user_heartbeat` — confirmed in `game_provider.dart`, `api_contract.dart`, `auth_provider.dart`, `play_limits_config.dart`.
- **`bsg_web_dashboard/src` does NOT call any of the agent-management RPCs this file defines** — it calls `admin_issue_coins`/`agent_transfer_coins`, defined only in File 6. This confirms the file's own stale-baseline warning: these RPCs are dead from the dashboard's perspective.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** From-scratch schema bootstrap for a digit-guessing betting game ("Triple Chance") on Supabase/Postgres, `SECURITY DEFINER` RPCs as the sole mutation path. Centers on a deterministic 103-second round clock derived from wall-clock epoch time, with outcomes computed either algorithmically (to hit a target RTP against actual stakes) or via an MD5 hash fallback when nobody bet. Settlement happens via both a server-driven sweep and a lazy per-player pull, guarded by row locking and an `is_resolved` flag.

**Non-Coder:** A numbers-lottery game where a new round starts automatically every ~103 seconds. Players place chips during the first 90 seconds; in the last 20, the system looks at how much was bet on each number and picks winning digits that make the house pay out close to its target percentage — like a carnival operator adjusting which numbers "hit" based on the crowd's bets rather than pulling numbers purely at random. If nobody bet, a fixed formula still produces an outcome. Winners get paid automatically.

### Section 3: Step-by-Step Logic Structure

1. **Clean Slate** — drops all game tables/functions, preserves `profiles`.
2. **Global Tables** — `profiles`, `active_sessions`, `transactions` + indexes.
3. **Game Tables** — `triple_chance_rounds`, `triple_chance_bets`, `play_limits` (seeded), `audit_log`, `agent_configs` (seeded).
4. **Global RPCs** — session create/validate/supersede, heartbeat, logout.
5. **Game RPCs** — limits fetch; RTP-outcome calculator; round-clock resolver (`get_current_round`, triggers RTP calc + settlement as side effects); settlement sweep; history; bet submission (two overloads); lazy per-bet resolver.
6. **RLS Enable** — all 8 tables, `SELECT`-only policies.
7. **Signup Trigger** — auto-creates `profiles` row from client-supplied `raw_user_meta_data`.
8. **Backfill** — syncs pre-existing `auth.users` into `profiles`.
9. **Agent-Scoped RLS** — `get_my_role()`/`get_my_agent_id()` helpers, re-scopes SELECT policies.
10. **Agent RPCs** — top-up/deduct/toggle-active/transfer/withdraw/issue-coins, each re-implementing its own authorization check.
11. **Schema Reload** — `NOTIFY pgrst`.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases — Critical**
1. **Guaranteed-win exploit via stale round IDs.** `submit_round_bet`'s only time gate checks *current wall-clock position*, never that `p_round_id` is the live round. Combined with public round readability and `get_my_round_result` having zero freshness check, a client could bet on an already-settled round's known winning digits for a guaranteed payout. *(See Executive Summary #3 — confirmed fixed in File 6/8.)*
2. **Privilege escalation via signup metadata.** `handle_new_user` reads `role`/`agent_id` straight from client-suppliable `raw_user_meta_data`. *(See Executive Summary #4 — confirmed fixed in File 6.)*
3. **Unvalidated JSONB bet keys → round-wide DoS.** `submit_round_bet` validates values, not keys; a non-numeric key throws an uncaught cast exception inside `calculate_round_rtp_outcome`, aborting resolution for the whole round. *(See Executive Summary #8 — confirmed fixed in File 6.)*

**🔐 Security & RLS Gaps**
- All mutation funneled through `SECURITY DEFINER` RPCs with no `INSERT`/`UPDATE`/`DELETE` RLS policies anywhere — defensible pattern, but means the above bugs have no secondary layer catching them.
- `audit_log` has RLS + a superadmin-only SELECT policy but nothing ever inserts into it in this file — dead table.
- `play_limits`/`agent_configs` have no non-SELECT policies — writes require `service_role`, undocumented here.
- Inconsistent Postgres error codes (`P0001` means different things in different functions). *(Resolved in v2 — Executive Summary #11.)*

**⚡ Performance & Lock Risks**
- No index on `profiles.agent_id` despite being the filter column for agent-scoped RLS and RPCs. *(Fixed in File 4.)*
- `resolve_round_payouts` locks the round row and loops+locks every unresolved bet inside one transaction, triggered from every polling client's `get_current_round` call near round-end — lock convoy risk on high-traffic rounds.
- `triple_chance_bets` indexed on `round_id` alone; settlement hot path filters `round_id + is_resolved`.

**🔗 Mobile/Web Misalignment**
- Agent-management RPCs this file defines (`agent_topup_player`, `transfer_coins_agent_to_player`, `issue_agent_coins`, etc.) are not what the dashboard actually calls (`admin_issue_coins`, `agent_transfer_coins` — File 6). If this file were the only one applied, the dashboard's coin-management pages would fail outright.

---

<a id="file-2"></a>
## File 2 — `20260806120000_fix_rtp_timing.sql`

Documents two named production incidents (**N-1**, **N-2**) with root cause and live evidence. Body confirmed "captured from production," corroborating File 1's staleness warning.

### Section 1: Database Objects & Schema Map

**Object touched:** `public.get_current_round()` — `CREATE OR REPLACE`, signature unchanged. No tables, indexes, triggers, or RLS touched.

**App & Dashboard Connections:** `bsg_app/lib/providers/game_provider.dart` polls this RPC. `bsg_web_dashboard/src/app/superadmin/actions.ts:320` calls it — confirmed as the "SuperAdmin Live Monitor" the header describes polling every 5 seconds, validating N-1's failure mode was real and reachable from actual dashboard code.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** Moves digit calculation and settlement from T+70s to T+94s within the 103s cycle — strictly after `submit_round_bet`'s T+93s cutoff — closing a race where digit generation and bet acceptance could overlap.

**Non-Coder:** The game previously sometimes "closed betting" 20+ seconds early by accident whenever a staff member glanced at the live monitor — players' last-second bets were silently rejected, and because almost nobody had bet yet at that early point, results were decided by a fixed formula instead of the configured payout target. This fix moves the "lock in the numbers" moment to just after betting genuinely closes.

### Section 3: Step-by-Step Logic Structure

1. Round identification unchanged.
2. Status computation unchanged.
3. **Draw trigger (changed):** now `secs_into >= 94` (was `>= 70`).
4. **Settlement trigger (changed):** also gated on `>= 94` (was `>= 90`) — aligning thresholds avoids wasted no-op calls.
5. Status persistence + response unchanged.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- **Race narrowed, not eliminated.** The 4-second buffer is a heuristic, not a guarantee — `calculate_round_rtp_outcome` locks the round row but aggregates bets via plain `SELECT` under READ COMMITTED; a bet accepted at second 93 but not yet committed by the time a poller draws at second 94 is still excluded. Converts a near-certain failure into a rare tail-latency race.
- **Empty-round outcome determinism — informational, not exploitable.** The MD5-seed fallback is publicly derivable, but since the branch choice (weighted vs. hash) is evaluated at draw time based on then-current stake, any attempt to exploit a predicted-empty round by betting on it immediately switches the round to the weighted branch — closing the loop, not an exploitable path.
- Does not touch `submit_round_bet` itself — its guards/cutoff are referenced but not defined here; File 1's guaranteed-win finding could not be ruled in/out from this file alone (later confirmed fixed in File 6/8).

**🔐 Security & RLS Gaps** — none new; inherits File 1's "no REVOKE EXECUTE FROM PUBLIC" condition.

**⚡ Performance & Lock Risks** — slight improvement: no-op `resolve_round_payouts` polling window shrinks from 12s to 8s.

**🔗 Mobile/Web Misalignment** — header explicitly flags (but doesn't fix) stale SuperAdmin Live Monitor UI copy describing the old 0–70s schedule.

---

<a id="file-3"></a>
## File 3 — `20260806123000_ledger_version_and_constraints.sql`

Cross-referencing `bsg_app/lib/services/api_contract.dart` here revealed the actual v2 RPC contract (`session_login`, `session_heartbeat`, `place_bet`, error codes `P0100`–`P0125`, `coin_balance`/`rounds`/`bets` naming) — reshaping how the rest of this audit reads prior files.

### Section 1: Database Objects & Schema Map

**Functions:**
- `public.update_user_heartbeat(uuid, text)` — `CREATE OR REPLACE`, adds `ledger_version` to return payload.
- `public.get_my_round_result_v2(text)` — **new**, thin wrapper adding `ledger_version` to `get_my_round_result`'s response.

**Constraints:**
| Table | Constraint | Rule |
|---|---|---|
| `profiles` | `profiles_balance_whole_check` | `balance = trunc(balance)` |
| `transactions` | `transactions_amount_whole_check` | `amount = trunc(amount) AND balance_after = trunc(balance_after)` |
| `transactions` | `transactions_type_check` | `type IN (5 values)` |

**App & Dashboard Connections — key finding:** `bsg_app`'s actual heartbeat call is `session_heartbeat` (confirmed `api_contract.dart:32`, `api_service.dart:150`), **not** `update_user_heartbeat`. Its round-result call is plain `get_my_round_result`, never `_v2`. **Both functions this migration touches appear to be dead code** against the shipped app — superseded later by the `rebuild_v2` naming scheme.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** Three fixes bundled: (1) surface `ledger_version` from more read paths for client-side ordering; (2) lock `balance`/`amount`/`balance_after` to whole numbers via `CHECK (x = trunc(x))`; (3) collapse `transactions.type` to the 5 values actually written.

**Non-Coder:** Defensive plumbing closing gaps where different parts of the system kept their own private lists of "reasons money moved," and where a $100.75 top-up could display as $100 forever. Also gives the mobile app a reliable "version number" so a slow network response can't roll back a more recent balance on screen.

### Section 3: Step-by-Step Logic Structure

1. `update_user_heartbeat` patch — adds `ledger_version` to response.
2. `get_my_round_result_v2` (new) — calls unmodified `get_my_round_result`, re-selects `ledger_version` after, merges via `||`.
3. Whole-coin constraints on `profiles`/`transactions`.
4. Transaction-type enum constraint.
5. Schema reload.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- **Dead-code migration** — both touched functions superseded/unused per the app's actual contract; the real M-5 fix landed differently in `rebuild_v2` (`session_heartbeat`).
- `get_my_round_result_v2` reads `ledger_version` in a separate statement/snapshot after calling `get_my_round_result` — a narrow TOCTOU gap, though not exploitable (result is always monotonically fresh enough).
- Constraints validated only against production data at write time (0 fractional balances, exactly 5 types) — correct for existing rows, but binds all future money-moving RPCs to this exact vocabulary.

**🔐 Security & RLS Gaps** — none introduced.

**⚡ Performance & Lock Risks** — `ALTER TABLE ... ADD CONSTRAINT` requires full validation at migration time; cheap at this data volume (11/25 rows per header), but a pattern to revisit with `NOT VALID` + `VALIDATE CONSTRAINT` staging at scale.

**🔗 Mobile/Web Misalignment** — **headline finding for this file:** the migration's stated purpose (give the client a `ledger_version` signal via heartbeat) targets a function (`update_user_heartbeat`) the shipped client doesn't call at all.

---

<a id="file-4"></a>
## File 4 — `20260807000000_rebuild_v2_schema.sql`

First file of the v2 rebuild trilogy (schema → RLS → functions). Table names/columns confirmed to match `api_contract.dart`'s documented contract exactly (`profiles`, `bets`, `rounds`, `coin_balance`).

### Section 1: Database Objects & Schema Map

**Teardown:** drops all v1/prior-v2 tables, dynamically drops every function in `public` via a `pg_proc`-iterating `DO` block, and **`DELETE FROM auth.users`** — every auth account (header confirms a verified backup preceded this).

**Tables created (7):**
| Table | Purpose | Notable Constraints |
|---|---|---|
| `profiles` | user/hierarchy | `coin_balance BIGINT ≥0`, `profiles_hierarchy_check`, `profiles_username_format`, `profiles_email_derived` |
| `rounds` | round registry | `phase` enum (betting/drawing/settled), `rounds_digits_complete`, `rounds_settled_has_digits` |
| `bets` | per-player bets | `bets_one_per_round` UNIQUE, `bets_payout_sum` |
| `coin_ledger` | append-only, replaces `transactions` | `kind` enum (7 values), `ledger_sign_matches_kind`, `ledger_game_has_round` |
| `active_sessions` | single-session enforcement | unchanged shape |
| `play_limits` | betting caps | singleton via `CHECK (id='global')` + PK, `play_limits_ordered` |
| `game_config` | replaces `agent_configs` | `rtp_percentage`, `draw_at_second` (91-102, default 94), `session_grace_sec` |
| `audit_log` | admin audit trail | `kind` enum, `actor_id` FK `ON DELETE SET NULL` |

**Indexes:** 14 total, including partial `idx_bets_unsettled` and `idx_profiles_username_lower`.

No functions, triggers, or RLS created here — pure DDL, `BEGIN...COMMIT` wrapped.

**App & Dashboard Connections:** Confirmed via `api_contract.dart`'s `Tbl` class — `bsg_app` reads `profiles`/`bets`/`rounds` **directly** (not exclusively through RPCs), per its own comment. RLS `SELECT` policies (File 5) therefore do real access-control work.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** Ground-up redesign converting previously function-level/convention-based invariants into structural constraints: whole-coin balances via `BIGINT` typing, strict single-level agent hierarchy, sign-consistent append-only ledger, atomic digit reveal, true singleton config tables, externalized `draw_at_second` config.

**Non-Coder:** The team starting over with lessons learned, turning "rules everyone is supposed to remember" into "rules the database itself refuses to break." Fractional coin balances, an agent reporting to another agent, and a mismatched ledger sign are now all physically impossible.

### Section 3: Step-by-Step Logic Structure

1. Teardown (tables, functions, auth users).
2. `pgcrypto` extension.
3. `profiles` — identity/hierarchy/wallet.
4. `rounds` — atomic-digit and settled-requires-digits CHECKs.
5. `bets` — payout-sum integrity CHECK.
6. `coin_ledger` — sign/kind consistency, round-linkage CHECKs.
7. `active_sessions`.
8. `play_limits` — singleton, min≤max ordering.
9. `game_config` — singleton, RTP/timing/grace config.
10. `audit_log`.
11. Commit.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- **Unprotected round-level aggregates** — `rounds.total_stake`/`total_payout` have no trigger/CHECK tying them to `SUM(bets.*)` for that round; drift is possible if a future function updates one without the other.
- **Timestamps not tied to state** — `rounds.drawn_at`/`settled_at` have no CHECK correlating them with `phase`/digit presence.
- **`profiles.email` self-consistency only** — no cross-table guarantee it matches `auth.users.email`.
- No self-transfer guard on `coin_ledger` (`counterparty_id = user_id` is not prevented).

**🔐 Security & RLS Gaps**
- No RLS enabled yet in this file — expected, sequencing dependency on File 5.
- **Positive, flagged for forward verification:** `profiles.role` has no `DEFAULT`, forcing explicit role on every INSERT — combined with the `@bestsmartgame.com` email-derivation design, strongly suggests (and was later confirmed in File 6) server-side-only account provisioning, closing the File 1 signup-escalation issue structurally.

**⚡ Performance & Lock Risks**
- `idx_profiles_agent` (partial) directly answers the under-indexing gap flagged in File 1.
- `idx_bets_unsettled` (partial) directly answers the settlement hot-path concern flagged in File 1.

**🔗 Mobile/Web Misalignment** — none found; first file with exact alignment to `api_contract.dart`.

---

<a id="file-5"></a>
## File 5 — `20260807000100_rebuild_v2_rls.sql`

Explicitly closes two named incidents: **D-1** (outcome disclosure via public round-read) and **A-5/C-6** (service-role key treated as implicit superadmin). Cross-checked against actual `.from(...)` calls across `bsg_web_dashboard/src`.

### Section 1: Database Objects & Schema Map

**Created:** `current_role_name()`, `current_is_active()` (`SECURITY DEFINER STABLE`); RLS enabled on all 8 tables; 8 `SELECT`-only policies (`profiles_select`, `rounds_select_settled`, `bets_select`, `coin_ledger_select`, `active_sessions_select`, `play_limits_select`, `game_config_select`, `audit_log_select`); `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ... FROM anon, authenticated`.

**App & Dashboard Connections:**
- Direct `.from(...)` calls confirmed extensively across dashboard server actions — these policies do continuous real access-control work.
- `audit_log` writes via `createAdminClient()` (service-role, `src/lib/supabase.ts:58`) — legitimate, trusted server-side bypass, consistent with the stated model.
- **Two stale endpoints found referencing a dropped column:** `src/app/api/user/profile/route.ts` and `src/app/api/auth/login/route.ts` both `SELECT balance` against `profiles`, renamed to `coin_balance` in File 4. The login route is **self-documented in its own header as "DEAD ENDPOINT — RECOMMENDED FOR DELETION."** The profile route carries no such note but is equally unreferenced by any live call site found.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** Layers RLS under a strict "read-only for clients, all writes through `SECURITY DEFINER` functions" model. `rounds_select_settled` refuses to expose a round row until `phase='settled'`, closing the outcome-disclosure hole at the RLS layer as a second line of defense behind File 2's timing fix.

**Non-Coder:** The security layer deciding who can see what, directly from the database, regardless of which app or tool is asking. Nobody can move money by talking to the database directly, and nobody can see winning numbers before betting closes. Also explicitly stops treating "this request used the admin master key" as proof of superadmin identity.

### Section 3: Step-by-Step Logic Structure

1. Role helpers (`SECURITY DEFINER` to avoid recursive self-restriction).
2. Enable RLS on all 8 tables.
3. `profiles_select` — own row / superadmin / agent-of-owner.
4. `rounds_select_settled` — settled only, or superadmin.
5. `bets_select` — own / superadmin / agent-of-owner.
6. `coin_ledger_select` — own (either party) / superadmin / agent-of-owner.
7. `active_sessions_select` — own row only.
8. `play_limits_select` — any authenticated user.
9. `game_config_select` — agent/superadmin only (hides `rtp_percentage` from players).
10. `audit_log_select` — superadmin only.
11. Hardening `REVOKE`.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- Two orphaned endpoints reference the dropped `balance` column (see above) — one self-flagged dead, one silently stale.

**🔐 Security & RLS Gaps**
- `REVOKE ... FROM anon, authenticated` is point-in-time, not a standing default — future tables need the same treatment repeated, or `ALTER DEFAULT PRIVILEGES`.
- No `FORCE ROW LEVEL SECURITY` — table owner bypasses RLS by default; harmless as currently used (owner role isn't client-exposed).
- `current_is_active()` defined but unreferenced in this file — worth tracking whether it's used in File 6 or is dead code.

**⚡ Performance & Lock Risks**
- `superadmin/actions.ts` pulls full-table data (`.range(0, 999999)`) from `profiles`/`bets` to compute dashboard aggregates client-side rather than via SQL aggregation — a scaling risk downstream of these policies as tables grow.

**🔗 Mobile/Web Misalignment** — two confirmed dead v1-era routes still coded against `profiles.balance`; landmines if ever re-wired to.

---

<a id="file-6"></a>
## File 6 — `20260807000200_rebuild_v2_functions.sql`

The full v2 RPC surface — cross-validated exactly against `api_contract.dart`. Most prior findings are genuinely fixed here; one serious new issue was found.

### 🔴 Headline finding: blocked accounts can still move/mint coins

`agent_transfer_coins` and `admin_issue_coins` authorize via:
```sql
SELECT role INTO v_role FROM public.profiles WHERE id = v_caller AND is_active;
IF v_role NOT IN ('agent','superadmin') THEN RAISE EXCEPTION 'UNAUTHORIZED' ...; END IF;
```
If the caller is deactivated, `v_role` becomes `NULL` (zero matching rows), and PL/pgSQL treats `IF <NULL> THEN` identically to `IF false THEN` — **the exception is silently skipped.** In `agent_transfer_coins`, the subsequent ownership check (`v_role = 'agent' AND v_player.agent_id <> v_caller`) is *also* NULL and *also* skipped, so a blocked caller can move coins between an arbitrary player and that player's real agent, neither of whom the caller has any verified relationship to. In `admin_issue_coins`, this means a blocked account can mint new coins into the system outright. Every other RPC in this file (`place_bet`, `session_login`, `session_heartbeat`) checks `is_active` correctly (select first, check the boolean explicitly afterward) — only these two cashier functions use the flawed shortcut. *(See Executive Summary #1.)*

### Section 1: Database Objects & Schema Map

**Functions (13):** `handle_new_user` (trigger), `apply_coin_movement`, `session_login`, `session_heartbeat`, `session_logout`, `get_play_limits`, `draw_round`, `settle_round`, `get_current_round`, `get_recent_rounds`, `place_bet`, `get_my_round_result`, `agent_transfer_coins`, `admin_issue_coins`, `verify_ledger_integrity`.

**Privilege model:** `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` then explicit `GRANT` to `authenticated` for exactly the 12 client-facing functions; internal functions (`apply_coin_movement`, `draw_round`, `settle_round`, `verify_ledger_integrity`) correctly kept ungranted. Nothing granted to `anon`.

**App & Dashboard Connections:** Every RPC name, parameter, and error code (`P0100`–`P0125`) in `api_contract.dart` matches this file exactly — zero naming drift, a marked improvement over every prior file.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** Consolidates all money movement through a single locked, ledger-writing primitive (`apply_coin_movement`), one idempotent `settle_round`, CSPRNG replacing the MD5-seed fallback, and round-freshness checked at the round's own state (`red IS NOT NULL`) rather than just wall-clock position. Account provisioning made controlled/admin-only.

**Non-Coder:** The rewrite meant to make cheating structurally impossible. The one thing that slipped through: the "is this person an agent or admin?" check quietly returns "I don't know" for a deactivated account, and the code treats "I don't know" as "yes."

### Section 3: Step-by-Step Logic Structure

1. **Account provisioning** — `handle_new_user` clamps role to agent/player, requires `agent_id` for players.
2. **`apply_coin_movement`** — lock row, apply delta, refuse negative result, bump `ledger_version`, write ledger row.
3. **Sessions** — `session_login` refuses (not displaces) a second device within grace; `session_heartbeat`/`session_logout` scoped to `auth.uid()`.
4. **Round lifecycle** — `get_play_limits`; `draw_round` (RTP-weighted scan / CSPRNG fallback); `settle_round` (idempotent); `get_current_round` (the clock); `get_recent_rounds` (real settled rounds only).
5. **Betting** — `place_bet`: identity/role/status checks, two independent round-open checks, strict key validation, server-recomputed stake, delta-only charging.
6. **Cashier** — `agent_transfer_coins`, `admin_issue_coins` — **both carrying the bug above.**
7. **Integrity check** — `verify_ledger_integrity`, internal-only.
8. **Execute grants** — default-deny then allow-list.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- **(Critical, above.)**
- **Modulo bias in CSPRNG fallback** — `get_byte(gen_random_bytes(1),0) % 10` biases digits 0–5 over 6–9. Suggestive that File 10 (named `fix_draw_round_gen_random_bytes.sql`) addresses this — later confirmed File 10 actually fixes a *different, more severe* bug (function name resolution), and this modulo bias remains unaddressed through File 13.
- **`admin_credit`/`admin_debit` ledger-kind conflation** — same `kind` values used for two different real-world events (agent's own balance moving vs. superadmin injecting money at the top of the hierarchy). *(See Executive Summary #6.)*
- Residual narrow settlement race, same shape as File 2 — `draw_round` locks the round row but aggregates bets via plain `SELECT` under READ COMMITTED.
- Stale doc comments in `bsg_app` referencing removed v1 identifiers — harmless.

**🔐 Security & RLS Gaps**
- **Confirmed fix:** File 1's guaranteed-win exploit — `place_bet` now checks `v_round.red IS NOT NULL` directly.
- **Confirmed fix:** File 1's signup privilege escalation — role hard-clamped, no self-service signup path found in `bsg_app`.
- **Confirmed fix:** File 1's uncaught-cast DoS — `place_bet` regex-validates every bet key before storage.
- **Confirmed fix:** competing `submit_round_bet` overloads (PostgREST ambiguity) — gone, one signature per name.

**⚡ Performance & Lock Risks** — `draw_round`'s 1,000-combination scan unchanged in shape; `apply_coin_movement` locks are consistently ordered across both transfer directions, avoiding deadlock.

**🔗 Mobile/Web Misalignment** — none found; exact lockstep with `api_contract.dart`.

---

<a id="file-7"></a>
## File 7 — `20260807001000_role_in_app_metadata.sql`

Fixes named vulnerability **S-2** (middleware trusting client-writable `user_metadata`). Verified directly against `middleware.ts` and `auth-guard.ts`.

### Section 1: Database Objects & Schema Map

**Touched:** `handle_new_user()` (re-replaced, adds `app_metadata` mirroring); `sync_role_to_app_metadata()` (new trigger function); trigger `on_profile_role_changed` (new, `AFTER UPDATE OF role`); one-time backfill `UPDATE auth.users ... FROM profiles`.

**App & Dashboard Connections:**
- `middleware.ts:65` — `user?.app_metadata?.role` — exact target of this fix, confirmed via its own `S-2 FIX` comment.
- `middleware.ts:63-64` states: *"This guard covers page routes only. Server actions independently re-verify through `requireAuth()`, which reads `public.profiles` directly."* Confirmed in `auth-guard.ts:64-75` — fresh DB lookup, fails closed on both `is_active === false` and role mismatch.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** Moves the source of truth for role-based UI routing from self-writable `raw_user_meta_data` to service-role-only `raw_app_meta_data`, kept synchronized via trigger.

**Non-Coder:** Previously, the "am I an admin?" flag the page guard checked was a field any logged-in user could edit on themselves. This moves that flag to a field only the system can write.

### Section 3: Step-by-Step Logic Structure

1. `handle_new_user` (rewritten) — same clamping, plus mirrors clamped role into new `auth.users` row's `app_metadata`.
2. `sync_role_to_app_metadata` (new) — fires only on actual `role` changes (`IS DISTINCT FROM` guard).
3. Trigger registration — `AFTER UPDATE OF role`.
4. Backfill for pre-existing accounts.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- **JWT staleness after a role change** — real but explicitly scoped: page-route gate can lag up to the JWT TTL, but every server action independently re-verifies fresh, so this cannot be leveraged for an actual privileged mutation.

**🔐 Security & RLS Gaps**
- **Corroborates and sharpens the File 6 finding.** The dashboard's "block agent" action only writes `profiles.is_active = false` — never touches `role`, so `sync_role_to_app_metadata` never fires, and no session is invalidated. Since `EXECUTE` on `agent_transfer_coins`/`admin_issue_coins` is granted at the `authenticated` role level (not gated by the Next.js app), a blocked account's still-valid JWT can be used to call these RPCs directly via the Supabase SDK/PostgREST, bypassing the (correctly implemented) dashboard-layer guard entirely and hitting the File 6 NULL-bypass bug. The Next.js app's own behavior is correct; it just isn't a substitute for the database's own authorization, which File 5's stated invariant says it shouldn't need to be.

**⚡ Performance & Lock Risks** — none of note.

**🔗 Mobile/Web Misalignment** — none; web-dashboard-specific, no mobile impact.

---

<a id="file-8"></a>
## File 8 — `20260807110000_place_bet_current_round_guard.sql`

Single hotfix with a concrete cited incident (a real bet booked at 21:26:48 against a round that ended at 21:25:18).

### Section 1: Database Objects & Schema Map

**Touched:** `place_bet(uuid, jsonb, jsonb, jsonb)` — `CREATE OR REPLACE`, signature unchanged, grants carry over automatically.

**App & Dashboard Connections:** Same as File 6 — `bsg_app`'s `RoundApiService.placeBet` is the sole caller.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** Adds a third, independent guard: the target round's `round_number` must equal the round number the server's own clock currently computes. Closes a gap where a round that ended its window but was never drawn (nothing triggered `draw_round` for it) sat forever with `red = NULL, phase = 'betting'` — a permanently valid-looking bet target that could never settle.

**Non-Coder:** A round nobody checked on right when it ended could get stuck in permanent limbo. A player's app holding a stale round reference could still place a real bet into it, which could then never be won back or refunded. This makes the rule absolute: a bet is only valid for the round happening right now, full stop.

### Section 3: Step-by-Step Logic Structure

1–2. (unchanged) Reject if digits drawn; reject if past `draw_at_second`.
3. **(new)** Reject if `round_number <> current_epoch/103`.
4. (unchanged) Key validation, stake computation, delta charging, upsert.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- **This fix also fully closes the original File 1 exploit family, more robustly than File 6 alone** — comparing round_number against the live clock rejects any non-current round outright, regardless of `red`/`phase` state.
- **Root cause not addressed here** — doesn't explain/prevent *why* a round goes undrawn (no server-side scheduled trigger existed yet). Correctly anticipated File 9 (`round_scheduler.sql`) as the likely next step — confirmed.
- Pre-existing stranded bets/rounds from before this fix are not remediated by this migration.
- Minor residual race: `v_into` and the round-number check both use `NOW()` (transaction-stable), consistent with each other, but if the transaction blocks on the round-row lock across the draw boundary, guards evaluate against a now-stale captured time — narrow, low-probability.

**🔐 Security & RLS Gaps** — none new; pure guard tightening.

**⚡ Performance & Lock Risks** — negligible added cost.

**🔗 Mobile/Web Misalignment** — none; fix is explicitly robust regardless of client behavior.

---

<a id="file-9"></a>
## File 9 — `20260807120000_round_scheduler.sql`

Confirms the predicted next step: adds a `pg_cron` safety net. Header cites hard evidence (only 2 of 17 live rounds had ever been drawn before this fix).

### Section 1: Database Objects & Schema Map

**Created:** `tick_rounds()` (`SECURITY DEFINER`, no params); `REVOKE ALL ON FUNCTION tick_rounds() FROM PUBLIC, anon, authenticated`; `pg_cron` extension; scheduled job `bsg-tick-rounds` every 10 seconds (idempotent re-schedule via unschedule-first).

**App & Dashboard Connections:** None directly — invoked exclusively by `pg_cron`; shares `draw_round`/`settle_round` with the client-triggered path.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** A cron job every 10 seconds ensures the current round exists even with zero connected clients, and processes a bounded backlog (up to 20 rounds/tick) of overdue-but-unresolved rounds using the same idempotent `draw_round`/`settle_round` functions.

**Non-Coder:** Previously the game's clock only ticked if a player happened to be looking at exactly the right second. This adds an automatic timekeeper that checks in every 10 seconds regardless of traffic, so a round always resolves on schedule.

### Section 3: Step-by-Step Logic Structure

1. Compute current round number.
2. Ensure current round row exists (`ON CONFLICT DO NOTHING`).
3. Select up to 20 overdue-and-unresolved rounds.
4. Draw + settle each (idempotent).
5. Return stats.
6. Lock down execution to non-client roles.
7. Register cron job, unscheduling any prior instance first.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- **No per-round fault isolation.** No `BEGIN...EXCEPTION...END` around individual `draw_round`/`settle_round` calls inside the loop — one problematic round aborts the whole tick (rolling back the whole batch) and would retry-fail every 10 seconds indefinitely, blocking every other overdue round behind it, with no logging. *(See Executive Summary #9.)*
- The stated rationale for revoking client EXECUTE ("could force an early draw") doesn't fully hold up under close reading — `tick_rounds()`'s own `WHERE` clause already structurally prevents drawing the live round early, same protection `get_current_round` relies on. The REVOKE is still correct practice regardless (least privilege, resource-abuse prevention).

**🔐 Security & RLS Gaps** — correctly locked down; cron executes as a superuser role, unaffected by the REVOKE (no self-lockout).

**⚡ Performance & Lock Risks** — `LIMIT 20` is a sound, explicitly-reasoned bound against a runaway catch-up transaction. Candidate-selection query intentionally unlocked (`SELECT`, not `FOR UPDATE`) — safe since real mutation safety lives inside `draw_round`/`settle_round`'s own locks. Portability note: `'10 seconds'` cron syntax requires a `pg_cron` version supporting sub-minute schedules.

**🔗 Mobile/Web Misalignment** — none; purely server-side.

---

<a id="file-10"></a>
## File 10 — `20260807130000_fix_draw_round_gen_random_bytes.sql`

Not the modulo-bias fix anticipated from File 6 — a completely different, more severe bug: the zero-stake fallback didn't work *at all*.

### Section 1: Database Objects & Schema Map

**Touched:** `draw_round(uuid)` — `CREATE OR REPLACE`. Only change: `gen_random_bytes(1)` → `extensions.gen_random_bytes(1)` (schema-qualified), 3 call sites.

**App & Dashboard Connections:** Same as File 6/9 — reached via `get_current_round()`/`tick_rounds()`.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** `pgcrypto`'s `gen_random_bytes()` lives in Supabase's `extensions` schema, not `public`. `draw_round` is `SECURITY DEFINER SET search_path TO 'public'` (a deliberately narrow, hardened search path), so the unqualified call couldn't resolve, and every zero-stake round raised `function gen_random_bytes(integer) does not exist` — an exception that propagated all the way up through `get_current_round()`.

**Non-Coder:** Whenever a round had zero bets (15 of the first 17, per the header), the "pick a fair random result" code crashed outright. The app couldn't tell this apart from a lost connection, so it showed a misleading network error while the round simply never produced a result.

### Section 3: Step-by-Step Logic Structure

Identical to File 6's `draw_round`; only the zero-stake `ELSE` branch's function calls are schema-qualified.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- **Modulo bias (File 6) remains unaddressed** — `% 10` on a uniform byte is unchanged.
- **QA/process gap:** the empty-bet branch — the *common* case, not an edge case — was apparently never exercised before shipping.
- **Root cause traces to File 4:** `CREATE EXTENSION IF NOT EXISTS pgcrypto` with no explicit `SCHEMA` clause landed in Supabase's project-default `extensions` schema, invisible to any `SET search_path TO 'public'` function — a schema-file decision surfacing as a functions-file bug two migrations later.
- **Verified this bug class doesn't extend to `gen_random_uuid()`** elsewhere in the schema — that function has been a native `pg_catalog` builtin since PostgreSQL 13, and `pg_catalog` is always implicitly searched first regardless of any explicit `search_path` override, so column-default UUID generation was never at risk.

**🔐 Security & RLS Gaps** — the fix's approach (fully qualify rather than widen `search_path`) is the security-conscious choice, explicitly reasoned in the header: widening the search path on a `SECURITY DEFINER` function would expand its trusted name-resolution/shadowing surface.

**⚡ Performance & Lock Risks** — none.

**🔗 Mobile/Web Misalignment** — explains a concrete instance of misleading "NO INTERNET CONNECTION" errors in `bsg_app` that had nothing to do with connectivity.

---

<a id="file-11"></a>
## File 11 — `20260807140000_pending_rounds_index.sql`

Small, targeted performance migration, direct follow-up to File 9.

### Section 1: Database Objects & Schema Map

**Created:** `rounds_pending_idx` — partial index on `rounds(round_number)` `WHERE red IS NULL OR phase <> 'settled'`, plus a documenting `COMMENT ON INDEX`.

**App & Dashboard Connections:** Serves exactly one consumer — `tick_rounds()` (File 9). `get_current_round()`'s equality lookup is already served by File 4's `idx_rounds_number`, unaffected.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** A partial index mirroring the "not yet resolved" half of `tick_rounds()`'s `WHERE` clause; self-maintaining, since a settled round's row automatically falls out of the index.

**Non-Coder:** Without this, the automatic round-timekeeper would have had to flip through the entire history of every round ever played, every single check, forever getting slower. This gives it a small, always-current shortlist of just the handful of rounds that actually need attention.

### Section 3: Step-by-Step Logic Structure

1. Create partial index.
2. Document intent via `COMMENT ON INDEX`.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases** — none found; comment's "matches exactly" is a slight overstatement (it matches one of two ANDed conditions, which is sufficient for planner eligibility) but not a functional issue.

**🔐 Security & RLS Gaps** — not applicable; indexes carry no privilege surface.

**⚡ Performance & Lock Risks** — well-reasoned fix. Minor non-urgent refinement: an `INCLUDE (id, red)` clause would make it a pure index-only scan, irrelevant at the stated 0-2 row cardinality. `CREATE INDEX` (not `CONCURRENTLY`) briefly locks the table — fine at this table's size.

**🔗 Mobile/Web Misalignment** — none; purely internal.

---

<a id="file-12"></a>
## File 12 — `20260807150000_fix_draw_round_rtp_reservoir_sampling.sql`

**The most severe fairness/correctness bug found in this audit.** Per the file's own header: `draw_round` **"always selected '000' whenever stake > 0."** *(See Executive Summary #2.)*

### Section 1: Database Objects & Schema Map

**Touched:** `draw_round(uuid)` — `CREATE OR REPLACE`. Adds an `ELSIF v_diff = v_best_diff` branch and two new locals (`v_tied_count`, `v_rnd`) to the RTP-weighted scan.

**App & Dashboard Connections:** Same as Files 6/9/10 — the core outcome-determination logic behind every round result shown to players and in the dashboard.

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** The original scan used strict `<` while iterating all 1,000 combinations in fixed order starting at `(0,0,0)`. Any time multiple combinations tied for best difference — the large majority, for realistic bet distributions, since most combinations pay nothing — only the *first-encountered* tied combination could ever win. Fix: reservoir sampling — each new tied candidate replaces the current selection with probability `1/N` (N = ties seen so far), guaranteeing a uniform, unbiased choice among however many end up tied.

**Non-Coder:** The "pick the fairest number" logic had a hidden, permanently rigged coin-flip. When several numbers looked equally good by its own math, it always mechanically defaulted to the first one it checked — almost always the same result. For essentially every round anyone actually bet on, the game had a strong, silent pull toward drawing the same outcome. The fix makes that tie-break a true fair toss among whatever's actually tied.

### Section 3: Step-by-Step Logic Structure

1–2. Round lock, stake aggregation — unchanged.
3. **Weighted scan (changed):** strictly-better combo taken unconditionally (tie counter reset to 1); exactly-tied combo increments the counter and replaces the current pick with probability `1/tied_count`.
4. Zero-stake fallback — unchanged (still `% 10`).
5. Persist digits, return result — unchanged.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases**
- **Retroactive concern, not fixable by SQL:** every round drawn between File 6/10's deployment and this fix almost certainly carried this bias — worth an operational/financial-reconciliation review of historical outcomes.
- **Implementation inefficiency, not a correctness bug:** `gen_random_bytes(2)` is called *twice* to build one 16-bit value, using `byte[0]` from the first call and `byte[1]` from the second — wasteful (double the CSPRNG calls needed) but the combined result remains mathematically uniform.
- **A much smaller residual modulo bias is introduced by this fix itself:** `v_rnd % v_tied_count` over a 65,536-value range — bounded bias under ~1.5% even in a worst-case 1,000-way tie, far smaller than the original `% 10` issue.
- **The original zero-stake `% 10` modulo bias remains completely unaddressed** — byte-for-byte unchanged from File 10, and no later file in this set touches it.

**🔐 Security & RLS Gaps** — none new; grants carry over automatically.

**⚡ Performance & Lock Risks** — up to ~2,000 additional CSPRNG calls possible in a pathological all-tied scenario; a reasonable, worthwhile trade for correctness. The double-call inefficiency above means this cost could be roughly halved for free.

**🔗 Mobile/Web Misalignment** — none in mechanics; be aware historical round data (if ever surfaced to players/agents) reflects the pre-fix bias.

---

<a id="file-13"></a>
## File 13 — `20260807160000_set_draw_at_second_90.sql`

Smallest file in the set, but tracing it against the current architecture (not just its own comment) surfaces the most structurally interesting finding in the audit: **it operates within a race-margin design that was already quietly lost in File 6, and it loosens the constraint that used to guard against it.**

### Section 1: Database Objects & Schema Map

**Touched:** `game_config` — `game_config_draw_at_second_check` widened from `BETWEEN 91 AND 102` to `BETWEEN 85 AND 102`; `draw_at_second` updated from 94 to 90 for the singleton row.

**App & Dashboard Connections:** `game_config.draw_at_second` is read fresh by `place_bet`, `get_current_round`, and `tick_rounds` on every call — this single data change instantly retimes the entire round lifecycle with no code deploy. `bsg_app`'s countdown UI is the stated motivation ("matching countdown 90 → 00").

### Section 2: Technical Overview & Non-Coder Explanation

**Technical:** Moves the shared draw/settlement trigger from second 94 to second 90, and widens the config table's own guard rail from a 91–102 floor to 85–102.

**Non-Coder:** Makes the in-app countdown timer hit exactly "00" at the same instant the server actually draws the numbers, instead of the numbers appearing 4 seconds after the visible countdown finished.

### Section 3: Step-by-Step Logic Structure

1. Drop old range check (91–102).
2. Add new, wider range check (85–102).
3. Update live config value from 94 to 90.

### Section 4: Deep-Dive Issue & Security Audit

**🐛 Bugs & Edge Cases — the headline finding**

File 2 built its fix around *two independent constants* — a bet cutoff and a draw trigger — with a deliberate 1-second gap between them. Since File 6's rebuild, **both checks read the same single `game_config.draw_at_second` value** (`place_bet`'s cutoff and `get_current_round`/`tick_rounds`' draw trigger). This means file 2's intended safety margin had *already* effectively collapsed to a sub-second sliver (a byproduct of integer-second truncation) the moment both thresholds were unified onto one shared config value — well before this file. This migration doesn't newly introduce that architectural characteristic, but it's worth recording clearly: **the deliberate safety margin File 2's header describes at length no longer actually exists in the current codebase**, regardless of which specific second `draw_at_second` is set to.

**🔐 Security & RLS Gaps**
- **Widening `game_config_draw_at_second_check` from 91–102 to 85–102 removes a documented safety invariant, not just a number.** File 4's original constraint comment states explicitly: *"Must be strictly after the betting cutoff so the two phases can never overlap (finding N-1)."* That lower bound was the schema-level guarantee backing that claim. The database can no longer enforce on its own that "draw always happens safely after betting closes" — that property now depends entirely on correct operational configuration, with only a much looser fence around it.
- To be clear: today's chosen value (90) is not itself demonstrated to be unsafe — the comment's own breakdown suggests a genuine 5-second client-side transmission grace (85→90). The concern is the *removed guard rail*, not necessarily today's setting.

**⚡ Performance & Lock Risks** — none; data/constraint change only.

**🔗 Mobile/Web Misalignment** — explicitly a mobile-alignment fix; assuming `bsg_app`'s own countdown/lock timing matches the 85s figure the comment describes, this should improve rather than harm consistency — worth a quick sanity check against `game_provider.dart`'s countdown logic if any mismatch is ever reported.

---

*End of report — 13 of 13 migration files audited.*
