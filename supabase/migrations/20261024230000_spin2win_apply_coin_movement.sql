-- #############################################################################
-- SPIN2WIN - STEP 4: spin2win_apply_coin_movement()
-- Migration: 20261024230000_spin2win_apply_coin_movement.sql
-- Plan: /spin2win/SPIN2WIN_BUILD_PLAN.md step 4
-- #############################################################################
--
-- PURELY ADDITIVE. Creates ONE new function. It does not alter, drop or
-- replace apply_coin_movement, lucky_card_apply_coin_movement or any other
-- existing object. The Triple Chance and Lucky Card money paths are untouched.
--
-- WHY A SEPARATE FUNCTION
-- -----------------------
-- Extending an existing function would create a Postgres overload or need a
-- DROP + CREATE; both are ruled out (RULE #21 M, Issue #120). This is the
-- Spin2Win twin of lucky_card_apply_coin_movement (20261005070000), step for
-- step: reject zero -> SELECT ... FOR UPDATE -> reject overdraft -> UPDATE
-- balance and ledger_version -> INSERT the ledger row -> RETURN the balance.
-- Balance and ledger row are written together under one row lock, which is
-- what keeps verify_ledger_integrity() reconciling.
--
-- The only differences from the Lucky Card twin: it writes
-- coin_ledger.spin2win_round_id (added in Step 3) instead of
-- lucky_card_round_id, and its two narrowing errors use new codes.
--
-- ERROR CODES: P0110/P0111/P0112 are reused deliberately so callers handle
-- Spin2Win failures exactly as they handle the other games'. P0118 and P0119
-- are new; verified free against the live database on 2026-10-24 (Step 1).
-- #############################################################################

BEGIN;

CREATE FUNCTION public.spin2win_apply_coin_movement(
  p_user_id           UUID,
  p_counterparty_id   UUID,
  p_kind              TEXT,
  p_amount            BIGINT,
  p_spin2win_round_id UUID,
  p_note              TEXT DEFAULT NULL
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

  -- Narrowing 1: a Spin2Win movement always belongs to a round.
  IF p_spin2win_round_id IS NULL THEN
    RAISE EXCEPTION 'Spin2Win movement must name a round' USING errcode = 'P0118';
  END IF;

  -- Narrowing 2: gameplay kinds only. Cashier movements use apply_coin_movement.
  IF p_kind NOT IN ('stake', 'stake_refund', 'payout') THEN
    RAISE EXCEPTION 'Spin2Win movement kind must be stake, stake_refund or payout'
      USING errcode = 'P0119';
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
    (user_id, counterparty_id, kind, amount, balance_after, spin2win_round_id, note)
  VALUES
    (p_user_id, p_counterparty_id, p_kind, p_amount, v_balance, p_spin2win_round_id, p_note);

  RETURN v_balance;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES - shipped in the same file as the function.
-- ---------------------------------------------------------------------------
-- This database's default privileges grant EXECUTE on every new function to
-- anon and authenticated (Issue #120). A coin-moving function must never be
-- callable by a client, so match apply_coin_movement's live ACL:
-- postgres + service_role only. It is called only by Spin2Win's own SECURITY
-- DEFINER functions (settle, place bet).
--
-- CREATE OR REPLACE keeps these grants; DROP + CREATE does NOT. Never DROP
-- this function without re-running the REVOKE.
REVOKE ALL ON FUNCTION public.spin2win_apply_coin_movement(UUID, UUID, TEXT, BIGINT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.spin2win_apply_coin_movement(UUID, UUID, TEXT, BIGINT, UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.spin2win_apply_coin_movement(UUID, UUID, TEXT, BIGINT, UUID, TEXT) IS
  'The single entry point for every Spin2Win balance change. Mirrors '
  'apply_coin_movement / lucky_card_apply_coin_movement step for step - row '
  'lock, overdraft check, balance and ledger_version update, ledger row - but '
  'writes coin_ledger.spin2win_round_id. The round is required and the kind '
  'must be stake, stake_refund or payout. Cashier movements use '
  'apply_coin_movement. Internal: service_role only.';

COMMIT;
