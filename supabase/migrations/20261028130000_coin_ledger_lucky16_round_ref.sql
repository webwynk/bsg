-- #############################################################################
-- LUCKY 16 CARD - STEP 3: coin_ledger GAINS A FOURTH ROUND REFERENCE
-- Migration: 20261028130000_coin_ledger_lucky16_round_ref.sql
-- Plan: "Lucky 16 Card: build plan" step 3 (shared-table change approved by
--       Hasan 2026-10-28, question 16)
-- #############################################################################
--
-- THIS IS THE ONLY MIGRATION IN THE LUCKY 16 CARD DATABASE SERIES THAT TOUCHES
-- A SHARED TABLE. It does two things to public.coin_ledger:
--   1. adds one nullable column, lucky16_round_id, and
--   2. replaces the ledger_game_has_round CHECK.
-- It changes no data, no function and no other table. It is the same change
-- Lucky Card (20261005060000) and Spin2Win (20261024220000) made.
--
-- WHY THIS IS NEEDED
-- ------------------
-- The live ledger_game_has_round (verified read-only 2026-10-28, Step 1)
-- requires a gameplay row (stake / stake_refund / payout) to name exactly one
-- of round_id (Triple Chance), lucky_card_round_id (Lucky Card) or
-- spin2win_round_id (Spin2Win). A Lucky 16 Card stake or payout has none of
-- them, so it would be rejected. Keeping ONE ledger keeps every balance check
-- working without touching it.
--
-- SAFETY
--   * Every existing row already satisfies the new rule: gameplay rows carry
--     exactly one of the three existing references and lucky16_round_id starts
--     NULL on all of them; cashier rows carry none.
--   * The functions of the other games that INSERT INTO coin_ledger use
--     EXPLICIT column lists, so a new nullable column cannot disturb them.
--     None of them is modified here.
--   * Adding a nullable column with no default is metadata-only: no rewrite.
--   * The DROP and the ADD run in ONE transaction, so there is never a moment
--     in which neither version of the rule is in force.
-- #############################################################################

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The fourth round reference.
-- ---------------------------------------------------------------------------
-- Nullable, because rows of the other three games never carry it.
-- ON DELETE RESTRICT mirrors the other references: rounds are financial
-- records and are never deleted.
ALTER TABLE public.coin_ledger
  ADD COLUMN lucky16_round_id UUID
  REFERENCES public.lucky16_rounds(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.coin_ledger.lucky16_round_id IS
  'Lucky 16 Card round this movement belongs to. Exactly one of round_id '
  '(Triple Chance), lucky_card_round_id (Lucky Card), spin2win_round_id '
  '(Spin2Win) or lucky16_round_id (Lucky 16 Card) is set on a gameplay row; '
  'all are NULL on a cashier row. Enforced by ledger_game_has_round.';

-- Mirrors idx_ledger_spin2win_round: only gameplay rows carry a round
-- reference, so the index skips the NULLs.
CREATE INDEX idx_ledger_lucky16_round
  ON public.coin_ledger (lucky16_round_id)
  WHERE lucky16_round_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The rule, rewritten.
-- ---------------------------------------------------------------------------
-- Before: a gameplay row names exactly one of three game rounds.
-- After:  a gameplay row names exactly one of FOUR game rounds, and a cashier
--         row names none. num_nonnulls(...) = 1 rejects both the "none" and
--         the "more than one" cases.
ALTER TABLE public.coin_ledger DROP CONSTRAINT ledger_game_has_round;

ALTER TABLE public.coin_ledger ADD CONSTRAINT ledger_game_has_round CHECK (
  CASE
    WHEN kind IN ('stake', 'stake_refund', 'payout')
      THEN num_nonnulls(round_id, lucky_card_round_id, spin2win_round_id, lucky16_round_id) = 1
    ELSE
      round_id IS NULL AND lucky_card_round_id IS NULL
        AND spin2win_round_id IS NULL AND lucky16_round_id IS NULL
  END
);

COMMENT ON CONSTRAINT ledger_game_has_round ON public.coin_ledger IS
  'A gameplay movement (stake / stake_refund / payout) must name exactly one '
  'game round: round_id for Triple Chance, lucky_card_round_id for Lucky Card, '
  'spin2win_round_id for Spin2Win or lucky16_round_id for Lucky 16 Card. A '
  'cashier movement names no round.';

COMMIT;
