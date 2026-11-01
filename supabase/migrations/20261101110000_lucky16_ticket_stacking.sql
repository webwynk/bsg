-- #############################################################################
-- PRINT TICKETS - LUCKY 16 CARD: TICKETS MAY STACK ON ONE CARD
-- Migration: 20261101110000_lucky16_ticket_stacking.sql
-- Plan: docs/print_phase3/PLAN.md
-- #############################################################################
--
-- The 10,000 limit is per ticket (Hasan, 2026-11-01), and a player may print
-- many tickets in a round with no top limit. Tickets add into the one
-- lucky16_bets row, so that row can pass 10,000 on a card. The 16 per-card rules
-- lose their upper number and keep "0, or at least 5".
--
-- lucky16_place_bet keeps its own 5 to 10,000 check, so a normal bet is limited
-- exactly as before. Nothing else reads the upper number.
--
-- Takes a short ACCESS EXCLUSIVE lock on lucky16_bets: apply after betting has
-- closed. Rollback: scripts/lucky16_print_rollback.sql
-- #############################################################################

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  v_rank TEXT;
  v_suit TEXT;
  v_col  TEXT;
BEGIN
  FOREACH v_rank IN ARRAY ARRAY['a','j','q','k'] LOOP
    FOREACH v_suit IN ARRAY ARRAY['hearts','spades','diamonds','clubs'] LOOP
      v_col := v_rank || '_' || v_suit;
      EXECUTE format('ALTER TABLE public.lucky16_bets DROP CONSTRAINT %I', 'lucky16_bets_' || v_col || '_check');
      EXECUTE format('ALTER TABLE public.lucky16_bets ADD CONSTRAINT %I CHECK (%I = 0 OR %I >= 5)',
                     'lucky16_bets_' || v_col || '_check', v_col, v_col);
    END LOOP;
  END LOOP;
END;
$$;

COMMIT;
