-- #############################################################################
-- LUCKY CARD - SECURITY HARDENING: REMOVE CLIENT WRITE RIGHTS FROM THE TABLES
-- Migration: 20261005160000_lucky_card_revoke_client_table_writes.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 14.22
-- #############################################################################
--
-- ONLY TOUCHES THE THREE LUCKY CARD TABLES. Nothing belonging to Triple Chance
-- is altered. This only REMOVES rights; it grants nothing and changes no data.
--
-- THE PROBLEM
-- -----------
-- The core-tables migration (20261005050000_lucky_card_core_tables.sql) enabled
-- row-level security and created SELECT-only policies, but it never removed the
-- default table rights Supabase hands to every new table: ALL rights for the
-- 'anon' (logged-out) and 'authenticated' (signed-in) roles. Row-level security
-- therefore stopped those roles from inserting, changing or deleting ROWS
-- (tested: refused or 0 rows touched), but it does not apply to TRUNCATE, which
-- empties a whole table in one command. Tested 2026-10-05 in rolled-back
-- transactions: as 'anon' and as 'authenticated', TRUNCATE succeeded on
-- lucky_card_config and lucky_card_bets, and was refused on Triple Chance's
-- game_config.
--
-- It was not reachable through the public API (PostgREST has no TRUNCATE
-- request, and pg_graphql is not installed), so nobody could use it today. It
-- was still a defect in this project's own tables that Triple Chance's tables do
-- not have, and the fix is to match them.
--
-- THE FIX
-- -------
-- Remove INSERT, UPDATE, DELETE and TRUNCATE from 'anon' and 'authenticated' on
-- lucky_card_rounds, lucky_card_bets and lucky_card_config. What remains for
-- those two roles is SELECT, REFERENCES, TRIGGER and MAINTAIN ('rxtm'), which is
-- exactly what Triple Chance's rounds, bets, game_config, coin_ledger and
-- profiles tables carry (read from the live ACLs). SELECT is kept because the
-- row-level policies and Realtime read through it.
--
-- WHAT IS NOT AFFECTED
-- --------------------
--   * Every Lucky Card game function is SECURITY DEFINER and runs as the table
--     owner, so it writes the tables exactly as before.
--   * The pg_cron job runs as the owner.
--   * The dashboard's server-side admin client uses 'service_role', whose rights
--     are not touched.
--   * Players and visitors never wrote these tables directly; they only ever
--     read them, through the SELECT policies.
--
-- Idempotent: running it again changes nothing.
-- #############################################################################

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.lucky_card_rounds, public.lucky_card_bets, public.lucky_card_config
  FROM anon, authenticated;

COMMIT;
