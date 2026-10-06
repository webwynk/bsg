-- #############################################################################
-- LUCKY CARD - PHASE 3: lucky_card_apply_coin_movement()
-- Migration: 20261005070000_lucky_card_apply_coin_movement.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 14.4 (Option 1, part C), 14.8 (Phase 3), 14.9
-- #############################################################################
--
-- PURELY ADDITIVE. Creates ONE new function. It does not alter, drop or
-- replace apply_coin_movement or any other existing object. Triple Chance's
-- money path is untouched.
--
-- WHY A SEPARATE FUNCTION RATHER THAN EXTENDING apply_coin_movement
-- ----------------------------------------------------------------
-- Adding a parameter to apply_coin_movement would create a Postgres OVERLOAD,
-- not a replacement. Competing submit_round_bet overloads are part of why the
-- v2 rebuild happened, and RULE #21 M forbids new overloads of existing
-- functions. DROP + CREATE is worse: the Issue #120 entry records that it
-- silently re-grants default privileges to anon and authenticated.
--
-- MIRRORS THE LIVE apply_coin_movement, NOT THE MIGRATION FILE
-- -----------------------------------------------------------
-- Phase 0 (spec 14.9) found the live function takes SIX parameters - it gained
-- p_note after the v2 rebuild, and writes coin_ledger.note. A version built
-- from the old five-parameter migration file would have silently dropped the
-- note on every Lucky Card movement. This mirrors the live signature.
--
-- Identical discipline to apply_coin_movement, step for step:
--   reject zero -> SELECT ... FOR UPDATE -> reject overdraft -> UPDATE balance
--   and ledger_version -> INSERT the ledger row -> RETURN the new balance.
-- Balance and ledger row are written together under one row lock, which is
-- what makes the ledger reconcilable.
--
-- TWO DELIBERATE NARROWINGS vs apply_coin_movement
-- ------------------------------------------------
--   1. p_lucky_card_round_id is REQUIRED, with no default. apply_coin_movement
--      defaults p_round_id to NULL because it serves both gameplay and cashier
--      movements; this function serves Lucky Card gameplay only, where a round
--      is always known. Cashier movements continue to use apply_coin_movement.
--   2. p_kind is checked against the three gameplay kinds. The
--      ledger_game_has_round constraint would reject a cashier kind carrying a
--      Lucky Card round anyway, but a named error beats a constraint violation.
--
-- ERROR CODES: P0110/P0111/P0112 are reused deliberately so callers handle
-- Lucky Card failures exactly as they handle Triple Chance ones. P0115 and
-- P0116 are new - verified free against every existing function, which already
-- uses P0100-P0101, P0110-P0114, P0120-P0125, P0130-P0137 and P0140.
-- #############################################################################

BEGIN;

CREATE FUNCTION public.lucky_card_apply_coin_movement(
  p_user_id             UUID,
  p_counterparty_id     UUID,
  p_kind                TEXT,
  p_amount              BIGINT,
  p_lucky_card_round_id UUID,
  p_note                TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_balance BIGINT;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'Coin movement must be non-zero' USING errcode = 'P0110';
  END IF;

  -- Narrowing 1: a Lucky Card movement always belongs to a round.
  IF p_lucky_card_round_id IS NULL THEN
    RAISE EXCEPTION 'Lucky Card movement must name a round' USING errcode = 'P0115';
  END IF;

  -- Narrowing 2: gameplay kinds only. Cashier movements use apply_coin_movement.
  IF p_kind NOT IN ('stake', 'stake_refund', 'payout') THEN
    RAISE EXCEPTION 'Lucky Card movement kind must be stake, stake_refund or payout'
      USING errcode = 'P0116';
  END IF;

  SELECT coin_balance INTO v_balance
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found' USING errcode = 'P0111';
  END IF;

  IF v_balance + p_amount < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_COINS' USING errcode = 'P0112';
  END IF;

  UPDATE public.profiles
     SET coin_balance   = coin_balance + p_amount,
         ledger_version = ledger_version + 1,
         updated_at     = NOW()
   WHERE id = p_user_id
   RETURNING coin_balance INTO v_balance;

  INSERT INTO public.coin_ledger
    (user_id, counterparty_id, kind, amount, balance_after, lucky_card_round_id, note)
  VALUES
    (p_user_id, p_counterparty_id, p_kind, p_amount, v_balance, p_lucky_card_round_id, p_note);

  RETURN v_balance;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES - not optional, and shipped in the same file as the function.
-- ---------------------------------------------------------------------------
-- This database's DEFAULT PRIVILEGES grant EXECUTE on every new function to
-- anon and authenticated (confirmed in pg_default_acl: several 'f' entries
-- carrying X for both roles). That is exactly the hole Issue #120 was filed to
-- close: a coin-moving function left with those grants is callable by anyone
-- holding the public anon key.
--
-- The target is apply_coin_movement's own live ACL, read from the catalogue:
--     {postgres=X/postgres, service_role=X/postgres}
-- i.e. anon and authenticated cannot execute it at all. This function is
-- internal; it is called by Lucky Card's own SECURITY DEFINER functions, never
-- by a client.
--
-- NOTE for any future change: CREATE OR REPLACE preserves these grants, but
-- DROP + CREATE does NOT - it re-applies the default privileges above and
-- silently re-opens the function to anon. Never DROP this function without
-- re-running the REVOKE.
REVOKE ALL ON FUNCTION public.lucky_card_apply_coin_movement(UUID, UUID, TEXT, BIGINT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.lucky_card_apply_coin_movement(UUID, UUID, TEXT, BIGINT, UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.lucky_card_apply_coin_movement(UUID, UUID, TEXT, BIGINT, UUID, TEXT) IS
  'The single entry point for every Lucky Card balance change. Mirrors '
  'apply_coin_movement step for step - row lock, overdraft check, balance and '
  'ledger_version update, ledger row - but writes coin_ledger.lucky_card_round_id '
  'instead of round_id. Narrower than its Triple Chance counterpart: the round '
  'is required and the kind must be stake, stake_refund or payout. Cashier '
  'movements use apply_coin_movement. Internal: service_role only.';

COMMIT;
