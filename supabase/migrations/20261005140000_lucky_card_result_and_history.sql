-- #############################################################################
-- LUCKY CARD - GAME FUNCTIONS 6a of 6: THE PLAYER'S RESULT AND THE RECENT RESULTS
-- Migration: 20261005140000_lucky_card_result_and_history.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 10 (result and history), 14.19
-- #############################################################################
--
-- PURELY ADDITIVE. Creates two new read-only functions. Nothing belonging to
-- Triple Chance is altered, dropped, replaced or called; get_my_round_result()
-- and get_recent_rounds() are untouched. Neither function writes anything.
--
-- 1. lucky_card_get_my_round_result(p_round_id uuid)
--    The calling player's own outcome for one round: whether they bet, what
--    they staked, what they were paid, whether their bet has been settled, and
--    their current coin balance and ledger version. The app calls it after the
--    wheel is decided, retrying until is_settled is true (large rounds are
--    settled in batches, so a bet can briefly be unsettled after the draw).
--    Mirrors get_my_round_result(): the same keys, the same behaviour for "no
--    bet" (placed_bet false, no error) and for an unknown round id. Lucky Card
--    has a single payout, so the three per-board payouts are replaced by
--    total_payout alone. A player can only ever read their own bet.
--
-- 2. lucky_card_get_recent_rounds(p_limit int DEFAULT 10)
--    The most recent DRAWN rounds, newest first, the same for every player
--    (history is global, spec 10). p_limit is clamped to 1..50; NULL means the
--    default of 10. Mirrors get_recent_rounds() with ONE addition the spec
--    requires: bonus_multiplier is returned for each round, because the result
--    tiles show the multiplier under each past card (N when 1). The bonus is
--    safe to return here because a round only appears once it has been drawn.
--    Each element: round_id, round_number, winning_rank, winning_suit,
--    bonus_multiplier, scheduled_at.
--
-- Both are SECURITY DEFINER and STABLE, callable by signed-in users and
-- service_role only, as the Triple Chance originals. They add no new error
-- codes; an unsigned-in call to the first raises P0100.
-- #############################################################################

BEGIN;

CREATE FUNCTION public.lucky_card_get_my_round_result(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_user UUID := auth.uid();
  v_bet  public.lucky_card_bets;
  v_p    public.profiles;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_user;
  SELECT * INTO v_bet FROM public.lucky_card_bets WHERE round_id = p_round_id AND user_id = v_user;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'placed_bet', false, 'total_stake', 0, 'total_payout', 0,
      'is_settled', false,
      'coin_balance', v_p.coin_balance, 'ledger_version', v_p.ledger_version);
  END IF;

  RETURN jsonb_build_object(
    'placed_bet',     true,
    'total_stake',    v_bet.total_stake,
    'total_payout',   v_bet.total_payout,
    'is_settled',     v_bet.is_settled,
    'coin_balance',   v_p.coin_balance,
    'ledger_version', v_p.ledger_version
  );
END;
$fn$;

CREATE FUNCTION public.lucky_card_get_recent_rounds(p_limit INTEGER DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(x ORDER BY x_round_number DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT r.round_number AS x_round_number,
           jsonb_build_object(
             'round_id',         r.id,
             'round_number',     r.round_number,
             'winning_rank',     r.winning_rank,
             'winning_suit',     r.winning_suit,
             'bonus_multiplier', r.bonus_multiplier,
             'scheduled_at',     r.scheduled_at
           ) AS x
      FROM public.lucky_card_rounds r
     WHERE r.winning_rank IS NOT NULL
     ORDER BY r.round_number DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
  ) s;
  RETURN v;
END;
$fn$;

-- Signed-in users and the server only. Default privileges would otherwise also
-- grant EXECUTE to anon (Issue #120). CREATE OR REPLACE keeps grants; DROP +
-- CREATE does not.
REVOKE ALL ON FUNCTION public.lucky_card_get_my_round_result(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lucky_card_get_my_round_result(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.lucky_card_get_recent_rounds(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lucky_card_get_recent_rounds(INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION public.lucky_card_get_my_round_result(UUID) IS
  'The calling player''s own Lucky Card outcome for one round: placed_bet, '
  'total_stake, total_payout, is_settled, coin_balance, ledger_version. Read-only. '
  'Signed-in users and service_role.';
COMMENT ON FUNCTION public.lucky_card_get_recent_rounds(INTEGER) IS
  'The most recent drawn Lucky Card rounds, newest first, global (limit 1..50, '
  'default 10), each with winning_rank, winning_suit and bonus_multiplier. '
  'Read-only. Signed-in users and service_role.';

COMMIT;
