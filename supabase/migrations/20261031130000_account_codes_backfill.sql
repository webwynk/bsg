-- #############################################################################
-- ACCOUNT IDS - STEP 2: ONE-TIME FILL FOR EXISTING ACCOUNTS
-- Migration: 20261031130000_account_codes_backfill.sql
-- Plan: account ID design (approved by Hasan 2026-10-31)
-- #############################################################################
--
-- Must run after 20261031120000_account_codes.sql. Gives every player and agent
-- without an ID its ID, oldest account first. Accounts created at the same
-- moment are ordered by username, so the order is the same on every run.
--
-- SAFE TO RE-RUN. Accounts that already have an ID are skipped, so this file is
-- also the repair for an account whose ID failed in the trigger. It reads
-- profiles and writes only account_codes and account_code_counters.
-- #############################################################################

BEGIN;

DO $$
DECLARE
  v_account RECORD;
  v_filled  INTEGER := 0;
  v_missing INTEGER;
BEGIN
  FOR v_account IN
    SELECT p.id, p.username
      FROM public.profiles p
     WHERE p.role IN ('player', 'agent')
       AND NOT EXISTS (SELECT 1 FROM public.account_codes c WHERE c.user_id = p.id)
     ORDER BY p.created_at, lower(p.username)
  LOOP
    PERFORM public.assign_account_code(v_account.id, v_account.username);
    v_filled := v_filled + 1;
  END LOOP;

  SELECT count(*) INTO v_missing
    FROM public.profiles p
   WHERE p.role IN ('player', 'agent')
     AND NOT EXISTS (SELECT 1 FROM public.account_codes c WHERE c.user_id = p.id);

  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'Backfill left % accounts without an ID', v_missing;
  END IF;

  RAISE NOTICE 'Account IDs given: %', v_filled;
END;
$$;

COMMIT;
