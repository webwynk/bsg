-- #############################################################################
-- PRINT TICKETS - SPIN2WIN: TICKETS MAY STACK ON ONE NUMBER
-- Migration: 20261101120000_spin2win_ticket_stacking.sql
-- Plan: docs/print_phase3/PLAN.md
-- #############################################################################
--
-- The same change as 20261101110000_lucky16_ticket_stacking.sql. The limit of
-- 10,000 is per ticket, and tickets add into the one spin2win_bets row, so the
-- 10 per-number rules lose their upper number and keep "0, or at least 5".
--
-- spin2win_place_bet keeps its own 5 to 10,000 check, so a normal bet is limited
-- exactly as before.
--
-- Takes a short ACCESS EXCLUSIVE lock on spin2win_bets: apply after betting has
-- closed. Rollback: scripts/spin2win_print_rollback.sql
-- #############################################################################

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  v_n INT;
BEGIN
  FOR v_n IN 0..9 LOOP
    EXECUTE format('ALTER TABLE public.spin2win_bets DROP CONSTRAINT %I', 'spin2win_bets_n' || v_n || '_check');
    EXECUTE format('ALTER TABLE public.spin2win_bets ADD CONSTRAINT %I CHECK (%I = 0 OR %I >= 5)',
                   'spin2win_bets_n' || v_n || '_check', 'n' || v_n, 'n' || v_n);
  END LOOP;
END;
$$;

COMMIT;
