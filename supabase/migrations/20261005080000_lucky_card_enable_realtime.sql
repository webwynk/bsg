-- #############################################################################
-- LUCKY CARD - ENABLE REALTIME for lucky_card_rounds and lucky_card_bets
-- Migration: 20261005080000_lucky_card_enable_realtime.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 14.7 (Q33)
-- #############################################################################
--
-- PURELY ADDITIVE. Adds two Lucky Card tables to the supabase_realtime
-- publication so the dashboard's Lucky Card views can auto-refresh the way the
-- Triple Chance views do (Q33). The existing members - bets, coin_ledger,
-- notifications, profiles, rounds - are not touched, and no table, policy,
-- function or replica identity is changed.
--
-- Mirrors 20260824170000_enable_dashboard_realtime.sql, which added rounds and
-- bets for Triple Chance. Verified against the live catalogue on 2026-10-05
-- before writing this file: the publication is not FOR ALL TABLES, every
-- current member uses the default replica identity with no column list and no
-- row filter, and both Lucky Card tables already have the default replica
-- identity - so a plain ADD TABLE gives them exactly the same treatment.
--
-- lucky_card_config is deliberately NOT added. Its Triple Chance counterpart,
-- game_config, is not in the publication either; operator settings are read
-- on demand, not streamed.
--
-- No RLS change. Realtime enforces each table's existing SELECT policy per
-- subscriber, so this does not change who can see which rows:
--   - lucky_card_rounds_select: non-superadmin roles see SETTLED rounds only.
--     A subscriber therefore cannot receive a round's winning card before it
--     is settled, exactly as with rounds_select_settled.
--   - lucky_card_bets_select: a player sees their own bets, an agent sees
--     their players' bets, a superadmin sees all.
-- #############################################################################

BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE public.lucky_card_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lucky_card_bets;

COMMIT;
