---
name: bsg-web-dashboard
description: Complete architecture, development, security, and design specification for the Best Smart Game (BSG) Web Dashboard (Admin and Agent panels) and backend server.
---

# BSG WEB DASHBOARD & BACKEND SPECIFICATION

This is the master index. It doesn't duplicate content from the five documents below — it describes how they fit together, what order to read them in, and the handful of cross-cutting decisions (auth strategy, RPC-only money movement, infra) that every one of them assumes as given. If a future change touches one of those cross-cutting decisions, all five docs need to be re-checked, not just the one that mentioned it first.

## Documentation Index

1. **[Frontend Development Specification](file:///d:/Download/Game/.agents/skills/bsg_web_dashboard/docs/01_frontend_development.md)**
   * Next.js App Router structure, component libraries (shadcn), pagination rules, loading states, and directory structures.

2. **[Design System (UI/UX)](file:///d:/Download/Game/.agents/skills/bsg_web_dashboard/docs/02_design_system.md)**
   * Tailwind color palettes (SaaS style), DM Sans typography, responsive layout rules, and component styling.

3. **[Database Schema](file:///d:/Download/Game/.agents/skills/bsg_web_dashboard/docs/03_database_schema.md)**
   * Supabase PostgreSQL table structures, relationships, indexing, and RPC functions.

4. **[Backend API Development](file:///d:/Download/Game/.agents/skills/bsg_web_dashboard/docs/04_backend_api.md)**
   * Next.js API Routes, Spin Engine algorithm (RTP math), and database transaction handlers.

5. **[Security Protocols](file:///d:/Download/Game/.agents/skills/bsg_web_dashboard/docs/05_security_protocols.md)**
   * Strict security measures including JWT handling, HttpOnly Cookies, Zod schema validation, Rate Limiting (Redis), and Row Level Security (RLS).

6. **[Flutter App (`bsg_app`) Game Functionality Specification](file:///d:/Download/Game/.agents/skills/bsg_web_dashboard/docs/06_game_functionality_spec.md)**
   * Complete technical specification of the mobile app (`bsg_app`) including login, lobby multi-slot system, 3-concentric ring wheel engine, multi-board betting (Single 9x, Double 90x, Triple 900x), chip controls, 60s global round sync, audio system, and info dialog.

7. **[System Architecture & End-to-End Functionality Flow](file:///d:/Download/Game/.agents/skills/bsg_web_dashboard/docs/07_system_architecture_and_end_to_end_flow.md)**
   * Deep technical breakdown explaining the complete system architecture and relationships between the Flutter Mobile App (`bsg_app`), Next.js Web Dashboard (`bsg_web_dashboard`), and Supabase PostgreSQL Database, with step-by-step concrete examples.



## Suggested read order

Read **3 (Database Schema) before 4 (Backend API) and 5 (Security)** — both of those documents assume the RPC functions and RLS posture defined in doc 3 and will read as under-specified without it. Read **1 (Frontend) and 2 (Design System) together** — the frontend's data-table/pagination/filter components are built directly against the Design System's component specs. This index (and doc 5) should be the last thing read, since both summarize decisions made across the other four.

## Cross-cutting decisions (apply to every document above)

These were established once, in one document, and every other document depends on them holding. Listing them here so a future contributor doesn't reintroduce a contradiction the way earlier drafts of these docs did (see each doc's own "What Changed" section for the specific fixes):

* **Auth is Supabase Auth, full stop** — no hand-rolled password hashing or custom JWT issuance anywhere in this codebase (doc 3 §1.1, doc 5 §2).
* **Money only moves through `SECURITY DEFINER` RPCs** (`process_bet`, `transfer_points`, `submit_round_bet`, `resolve_round`) — no client, Route Handler, or RLS policy is ever allowed to `INSERT`/`UPDATE` a balance or the ledger tables directly (doc 3 §3, doc 5 §5–6).
* **`service_role` key is server-only, always** — never in the Flutter app, never in the Next.js client bundle (doc 5 §0).
* **API routes are for mobile/webhook consumers only**; internal dashboard-only mutations are Server Actions (doc 1 §3.5, doc 4 §1).
* **Database Migrations Protocol** — Whenever a database migration or schema update is required, always generate a timestamped SQL migration file in `bsg_web_dashboard/supabase/migrations/`, update `03_database_schema.md` and related docs, update `SKILL.md`, and notify the user with the SQL query so it can be applied to Supabase.


---

## 6. Infrastructure & Deployment

This section exists because the original note below ("optimized... to flawlessly handle 50,000 users") was a capacity *claim* with no supporting plan attached, and it also quietly commits to an infrastructure decision — self-hosting the full stack — that none of the other five documents were written assuming. Both are worth making explicit rather than leaving as a one-line footnote.

> Deployed via **Coolify** on a **Hostinger KVM 2 VPS (2 vCPU, 8 GB RAM)**.

### 6.1 What this implies that wasn't stated
Coolify on a single VPS almost always means **self-hosted Supabase** (Postgres, GoTrue/Auth, Realtime, Storage — each running as its own container on that same box), not the managed Supabase Cloud platform. That distinction matters a lot for a system whose other four documents lean heavily on Supabase's managed guarantees:
* Managed Supabase gives you automated point-in-time recovery backups, connection pooling (PgBouncer) already configured, and a support/SLA path. Self-hosting means **you** are now responsible for all of that — none of it exists by default in a self-hosted `docker-compose` deployment.
* If Redis (for rate limiting, per Security Protocols §7) is *also* co-located on this same 2-vCPU box alongside Postgres and the Next.js server, all three are competing for the same two cores during a traffic spike — exactly when you need rate limiting and DB locking to both be fast.

**Decision to make explicit, not assume:** confirm whether this is genuinely self-hosted Supabase on this VPS, or whether "Coolify" is deploying only the Next.js app while Postgres/Auth remain on Supabase Cloud (a much more common and lower-risk split). The rest of this section assumes the fully self-hosted case, since that's what the note as written implies.

### 6.2 On the "flawlessly handle 50,000 users, 5,000 DAU" claim
This needs a load test behind it, not an assertion — "flawlessly" isn't an engineering spec. A few concrete things that will determine whether 2 vCPU / 8 GB actually holds at that scale, all of which are answerable with a load-testing pass before launch rather than after:
* **Postgres connection limits.** Self-hosted Postgres on 8 GB RAM has a real, fairly low `max_connections` ceiling. Every `process_bet` call takes a row lock for the duration of its transaction (Database Schema §3.1, by design) — under concurrent spin load, connection exhaustion or lock contention will surface as request timeouts on the Spin Engine specifically, the one endpoint with a stated < 100ms target.
* **No stated redundancy.** A single VPS is a single point of failure. If it goes down mid-transaction, what's the recovery story — does an in-flight `process_bet` transaction leave the system in a consistent state (it should, since Postgres transactions are atomic by construction), and is there a documented restore procedure from backup, with a target RTO/RPO?
* **Backup strategy is currently unstated.** For a system whose entire purpose is an accurate money ledger, "what's the backup schedule, where are backups stored (off the same VPS), and has a restore actually been tested" needs an answer before this is a launch blocker, not a nice-to-have.

**Recommendation:** run a load test (e.g. k6 or Artillery) simulating the target concurrent-spin rate against a staging copy of this exact VPS spec before treating "50,000 users / 5,000 DAU" as validated. If it doesn't hold, the fix is more likely "move Postgres to managed Supabase Cloud and keep only the Next.js app on the VPS" than "add more vCPUs to the same self-hosted box" — decoupling the stateless app tier from the stateful database tier is usually the better lever.

### 6.3 Minimum operational baseline before launch
Not present anywhere in the original five documents or this index — worth its own short document (`06_infrastructure_deployment.md`) if this project doesn't already have one:
* Automated, off-box backups with a periodically *tested* restore procedure.
* Health checks + alerting (uptime, Postgres connection count, error rate) wired to something that pages a human, not just a dashboard nobody's watching.
* A staging environment that mirrors production topology, so the load test in §6.2 is testing something representative.
* Zero-downtime deploy process through Coolify, so a deploy doesn't drop in-flight requests to the Spin Engine mid-transaction.