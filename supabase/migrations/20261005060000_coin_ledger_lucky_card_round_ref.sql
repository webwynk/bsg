-- #############################################################################
-- LUCKY CARD - PHASE 2: coin_ledger GAINS A SECOND ROUND REFERENCE
-- Migration: 20261005060000_coin_ledger_lucky_card_round_ref.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 14.4 (Option 1), 14.8 (Phase 2), 14.9
-- #############################################################################
--
-- THIS IS THE ONLY MIGRATION IN THE LUCKY CARD SERIES THAT TOUCHES AN OBJECT
-- BELONGING TO TRIPLE CHANCE. It does two things to public.coin_ledger:
--   1. adds one nullable column, and
--   2. replaces the ledger_game_has_round CHECK.
-- It changes no data, no function, and no other table.
--
-- WHY THIS IS NEEDED
-- ------------------
-- coin_ledger.round_id references public.rounds only, and the existing CHECK
-- requires gameplay rows to carry it:
--
--     CHECK ((kind <> ALL (ARRAY['stake','stake_refund','payout']))
--            OR (round_id IS NOT NULL))
--
-- So a Lucky Card stake or payout has no valid value to put in round_id and
-- cannot leave it NULL either: the row is rejected and the bet fails. Option 1
-- of spec 14.2 was chosen because it keeps ONE ledger, which is what lets
-- verify_ledger_integrity() go on reconciling every balance against every
-- movement without being touched. A separate Lucky Card ledger would have made
-- every Lucky Card player a permanent integrity violation.
--
-- SAFETY - all verified against the live database before this was written:
--   * Phase 0 (spec 14.9) counted ZERO non-gameplay rows carrying a round_id,
--     so the stricter half of the new CHECK validates against existing data.
--   * coin_ledger is 14,601 rows / 4 MB, so the constraint validates instantly.
--     The NOT VALID + separate VALIDATE split planned in spec 14.4 is therefore
--     unnecessary, and is deliberately not used: a single validated ADD leaves
--     no window in which an unvalidated constraint exists.
--   * No view, materialised view, ROWTYPE reference, SELECT *, or trigger
--     depends on coin_ledger's column list.
--   * Both functions that INSERT INTO coin_ledger - apply_coin_movement and
--     settle_round - use EXPLICIT column lists, so a new nullable column
--     cannot disturb them. Neither function is modified by this migration.
--   * The DROP and the ADD run in ONE transaction, so there is never a moment
--     in which neither version of the rule is in force.
-- #############################################################################

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The second round reference.
-- ---------------------------------------------------------------------------
-- Nullable, because Triple Chance rows will never carry it. ON DELETE RESTRICT
-- mirrors round_id's own deliberate choice: rounds are financial records and
-- are never deleted, and the schema states that intent rather than leaving a
-- contradiction. Adding a nullable column with no default is metadata-only in
-- modern Postgres, so this does not rewrite the table.
ALTER TABLE public.coin_ledger
  ADD COLUMN lucky_card_round_id UUID
  REFERENCES public.lucky_card_rounds(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.coin_ledger.lucky_card_round_id IS
  'Lucky Card round this movement belongs to. Exactly one of round_id '
  '(Triple Chance) or lucky_card_round_id (Lucky Card) is set on a gameplay '
  'row; both are NULL on a cashier row. Enforced by ledger_game_has_round.';

-- Mirrors idx_ledger_round, which is partial for the same reason: only
-- gameplay rows carry a round reference, so indexing the NULLs would be waste.
CREATE INDEX idx_ledger_lucky_card_round
  ON public.coin_ledger (lucky_card_round_id)
  WHERE lucky_card_round_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The rule, rewritten.
-- ---------------------------------------------------------------------------
-- Before: a gameplay row must name a Triple Chance round.
-- After:  a gameplay row names EXACTLY ONE game's round, and a cashier row
--         names neither.
--
-- The XOR is written as (a IS NOT NULL) <> (b IS NOT NULL), which rejects both
-- the "neither" and the "both" cases. "Both" would be a row claiming to belong
-- to two games at once - impossible today, but the constraint should say so
-- rather than rely on no one ever writing it.
--
-- The nine kinds below are the live coin_ledger_kind_check list as of
-- 2026-10-05, confirmed against the catalogue: agent_ledger_credit and
-- agent_ledger_debit were added after the v2 rebuild (Issue #6) and are
-- cashier movements, so they fall in the ELSE branch.
ALTER TABLE public.coin_ledger DROP CONSTRAINT ledger_game_has_round;

ALTER TABLE public.coin_ledger ADD CONSTRAINT ledger_game_has_round CHECK (
  CASE
    WHEN kind IN ('stake', 'stake_refund', 'payout')
      THEN (round_id IS NOT NULL) <> (lucky_card_round_id IS NOT NULL)
    ELSE
      round_id IS NULL AND lucky_card_round_id IS NULL
  END
);

COMMENT ON CONSTRAINT ledger_game_has_round ON public.coin_ledger IS
  'A gameplay movement (stake / stake_refund / payout) must name exactly one '
  'game round: round_id for Triple Chance or lucky_card_round_id for Lucky '
  'Card, never both and never neither. A cashier movement names no round.';

COMMIT;
