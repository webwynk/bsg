-- #############################################################################
-- BSG v2 — Enable Realtime for public.profiles, public.bets, public.coin_ledger,
-- public.rounds
-- Migration: 20260824170000_enable_dashboard_realtime.sql
-- #############################################################################
--
-- Phase 0 of the bsg_web_dashboard refresh redesign: replaces per-page
-- setInterval polling (10s on agent/players, 90s on superadmin/agents/[slug],
-- 5s on superadmin/live-game, 60s on the remaining list pages) with a single
-- shared Realtime subscription (LiveDataProvider, mounted once per portal
-- layout) that pushes changes to the browser the instant they happen.
--
-- Confirmed live before this migration: only public.notifications was in the
-- supabase_realtime publication (re-checked immediately before writing this
-- file, in addition to the check earlier in the same session). This
-- migration adds the four tables the new pages actually need to watch.
--
-- No RLS change, on any of the four tables:
--   - profiles_select: agent sees own players (agent_id = auth.uid()),
--     superadmin sees all. Already exactly the scoping the players/agents
--     list pages need.
--   - bets_select / coin_ledger_select: same agent/superadmin scoping
--     pattern, already correct for the pages that read these tables.
--   - rounds_select_settled: non-superadmin roles see settled rounds only;
--     superadmin (the only role that reads live/in-progress rounds, via
--     superadmin/live-game) is explicitly exempted by the policy already.
-- Realtime enforces each table's existing SELECT policy per subscriber, so
-- turning on broadcast here does not change who can see which rows — only
-- that rows they could already see now arrive the instant they change,
-- instead of on the next poll.
--
-- Deliberately NOT included: public.active_sessions (the online/offline
-- status table). Its current RLS (user_id = auth.uid() only) has no
-- agent/superadmin carve-out, so a direct Realtime subscription would
-- silently receive nothing for other users' rows as-is. Per explicit user
-- decision, online/offline status stays on its existing slow background
-- check rather than widening a session-security policy for a cosmetic-only
-- benefit. Revisit only if/when instant status is explicitly requested.
-- #############################################################################

BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coin_ledger;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rounds;

COMMIT;
