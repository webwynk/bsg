-- #############################################################################
-- LUCKY 16 CARD - STEP 8: ENABLE REALTIME for lucky16_rounds and lucky16_bets
-- Migration: 20261028180000_lucky16_enable_realtime.sql
-- Plan: "Lucky 16 Card: build plan" step 8
-- #############################################################################
--
-- Adds two Lucky 16 Card tables to the shared supabase_realtime publication so
-- the dashboard's Lucky 16 Card views can auto-refresh the way the other
-- games' views do. This adds members to a SHARED object (the publication).
-- The existing members - bets, coin_ledger, lucky_card_bets,
-- lucky_card_rounds, notifications, profiles, rounds, spin2win_bets,
-- spin2win_rounds (verified live 2026-10-28, Step 1) - are not touched, and
-- no table, policy, function or replica identity is changed.
--
-- Mirrors 20261024270000_spin2win_enable_realtime.sql exactly.
-- lucky16_config is deliberately NOT added (no game's config is in the
-- publication; settings are read on demand).
--
-- No RLS change. Realtime enforces each table's SELECT policy per subscriber:
--   - lucky16_rounds_select: non-superadmin roles see SETTLED rounds only, so
--     a subscriber can never receive the winning card before settlement.
--   - lucky16_bets_select: a player sees their own bets, an agent their
--     players' bets, a superadmin all.
--
-- Kill switch: ALTER PUBLICATION supabase_realtime with the DROP form for the
-- same two tables (touches nothing else). Not written out literally here
-- because apply_sql_to_live_db.js refuses any file containing that phrase.
-- #############################################################################

BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE public.lucky16_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lucky16_bets;

COMMIT;
