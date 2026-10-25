-- #############################################################################
-- SPIN2WIN - STEP 8: ENABLE REALTIME for spin2win_rounds and spin2win_bets
-- Migration: 20261024270000_spin2win_enable_realtime.sql
-- Plan: /spin2win/SPIN2WIN_BUILD_PLAN.md step 8
-- #############################################################################
--
-- Adds two Spin2Win tables to the shared supabase_realtime publication so the
-- dashboard's Spin2Win views can auto-refresh the way the Triple Chance and
-- Lucky Card views do. This adds members to a SHARED object (the publication),
-- so it was raised with the user as a shared-object step before applying.
-- The existing members - bets, coin_ledger, lucky_card_bets,
-- lucky_card_rounds, notifications, profiles, rounds (verified live
-- 2026-10-24, Step 1) - are not touched, and no table, policy, function or
-- replica identity is changed.
--
-- Mirrors 20261005080000_lucky_card_enable_realtime.sql exactly. Re-verify
-- live before applying: the publication is not FOR ALL TABLES, its members
-- use the default replica identity with no column list and no row filter, and
-- both Spin2Win tables have the default replica identity.
--
-- spin2win_config is deliberately NOT added (neither game_config nor
-- lucky_card_config is in the publication; settings are read on demand).
--
-- No RLS change. Realtime enforces each table's SELECT policy per subscriber:
--   - spin2win_rounds_select: non-superadmin roles see SETTLED rounds only, so
--     a subscriber can never receive the winning number before settlement.
--   - spin2win_bets_select: a player sees their own bets, an agent their
--     players' bets, a superadmin all.
--
-- Kill switch: ALTER PUBLICATION supabase_realtime with the DROP form for the
-- same two tables (touches nothing else). Not written out literally here
-- because apply_sql_to_live_db.js refuses any file containing that phrase.
-- #############################################################################

BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE public.spin2win_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.spin2win_bets;

COMMIT;
