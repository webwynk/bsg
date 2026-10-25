-- #############################################################################
-- SPIN2WIN - STEP 3: coin_ledger GAINS A THIRD ROUND REFERENCE
-- Migration: 20261024220000_coin_ledger_spin2win_round_ref.sql
-- Plan: /spin2win/SPIN2WIN_BUILD_PLAN.md step 3, decision D2 option A
--       (approved by the user 2026-10-24 as a change to a shared table)
-- #############################################################################
--
-- THIS IS THE ONLY MIGRATION IN THE SPIN2WIN SERIES THAT TOUCHES A SHARED
-- OBJECT. It does two things to public.coin_ledger:
--   1. adds one nullable column, spin2win_round_id, and
--   2. replaces the ledger_game_has_round CHECK.
-- It changes no data, no function and no other table. It is the same change
-- Lucky Card made in 20261005060000_coin_ledger_lucky_card_round_ref.sql.
--
-- WHY THIS IS NEEDED
-- ------------------
-- The live ledger_game_has_round (verified read-only 2026-10-24, Step 1)
-- requires a gameplay row (stake / stake_refund / payout) to name exactly one
-- of round_id (Triple Chance) or lucky_card_round_id (Lucky Card). A Spin2Win
-- stake or payout has neither, so it would be rejected. Keeping ONE ledger is
-- what lets verify_ledger_integrity() keep reconciling every balance against
-- every movement without being touched.
--
-- SAFETY
--   * Every existing row already satisfies the new rule: gameplay rows carry
--     exactly one of the two existing references and spin2win_round_id starts
--     NULL on all of them; cashier rows carry none.
--   * Both functions that INSERT INTO coin_ledger for the other games
--     (apply_coin_movement / settle_round and their lucky_card_ twins) use
--     EXPLICIT column lists, so a new nullable column cannot disturb them.
--     None of them is modified here. Re-verify live before applying.
--   * Adding a nullable column with no default is metadata-only: no rewrite.
--   * The DROP and the ADD run in ONE transaction, so there is never a moment
--     in which neither version of the rule is in force.
-- #############################################################################

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The third round reference.
-- ---------------------------------------------------------------------------
-- Nullable, because Triple Chance and Lucky Card rows never carry it.
-- ON DELETE RESTRICT mirrors round_id and lucky_card_round_id: rounds are
-- financial records and are never deleted.
ALTER TABLE public.coin_ledger
  ADD COLUMN spin2win_round_id UUID
  REFERENCES public.spin2win_rounds(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.coin_ledger.spin2win_round_id IS
  'Spin2Win round this movement belongs to. Exactly one of round_id '
  '(Triple Chance), lucky_card_round_id (Lucky Card) or spin2win_round_id '
  '(Spin2Win) is set on a gameplay row; all are NULL on a cashier row. '
  'Enforced by ledger_game_has_round.';

-- Mirrors idx_ledger_lucky_card_round: only gameplay rows carry a round
-- reference, so the index skips the NULLs.
CREATE INDEX idx_ledger_spin2win_round
  ON public.coin_ledger (spin2win_round_id)
  WHERE spin2win_round_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The rule, rewritten.
-- ---------------------------------------------------------------------------
-- Before: a gameplay row names exactly one of two game rounds.
-- After:  a gameplay row names exactly one of THREE game rounds, and a
--         cashier row names none. num_nonnulls(...) = 1 rejects both the
--         "none" and the "more than one" cases.
ALTER TABLE public.coin_ledger DROP CONSTRAINT ledger_game_has_round;

ALTER TABLE public.coin_ledger ADD CONSTRAINT ledger_game_has_round CHECK (
  CASE
    WHEN kind IN ('stake', 'stake_refund', 'payout')
      THEN num_nonnulls(round_id, lucky_card_round_id, spin2win_round_id) = 1
    ELSE
      round_id IS NULL AND lucky_card_round_id IS NULL AND spin2win_round_id IS NULL
  END
);

COMMENT ON CONSTRAINT ledger_game_has_round ON public.coin_ledger IS
  'A gameplay movement (stake / stake_refund / payout) must name exactly one '
  'game round: round_id for Triple Chance, lucky_card_round_id for Lucky Card '
  'or spin2win_round_id for Spin2Win. A cashier movement names no round.';

COMMIT;
