-- #############################################################################
-- LUCKY CARD - GAME FUNCTIONS 6b: THE "THIS ROUND" BONUS BOOST
-- Migration: 20261005150000_lucky_card_apply_bonus_to_current_round.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 5 (bonus), 14.21
-- #############################################################################
--
-- PURELY ADDITIVE. Creates one new function. Nothing belonging to Triple
-- Chance is altered, dropped, replaced or called; apply_bonus_to_current_round()
-- is untouched.
--
-- WHAT IT DOES
-- ------------
-- Sets the bonus multiplier (1 = "N", then 2 to 10) of the Lucky Card round the
-- server clock is in NOW, before it is drawn. This is the database half of the
-- dashboard's "This Round" boost. It mirrors Triple Chance's
-- apply_bonus_to_current_round(), with the range widened from 1..4 to 1..10
-- (spec 5).
--
-- OPTION B, chosen by the user 2026-10-05: exactly like Triple Chance. The only
-- database rule is "refused once the round has been drawn". There is no extra
-- time cutoff here. The dashboard page is expected to lock the button earlier
-- on its own, as Triple Chance's page does at second 75, but that is a
-- convenience for the admin and not what makes this safe.
--
-- IT NEVER TOUCHES lucky_card_config. Only the running round's own pinned
-- bonus_multiplier is written. The "Next Round" dial lives in lucky_card_config
-- and is a separate control; writing it from here would let a boost leak into
-- the next round (the same reasoning as Triple Chance's Issue #99).
--
-- SAFETY
-- ------
--   * The round is found from the server clock, never from a client-supplied
--     id, so it can only ever affect the round in progress.
--   * The round row is locked FOR UPDATE, the same lock lucky_card_draw_round()
--     takes, so a boost and the draw cannot interleave: whichever gets the row
--     first wins cleanly. (A boost also waits for any bet still in flight, as
--     bets hold the row FOR SHARE, and a bet arriving while the boost holds the
--     row waits for it. Both waits last milliseconds.)
--   * The draw never reads the bonus; the bonus only multiplies a winner's
--     payout in lucky_card_settle_round(), from the round's own pinned value.
--   * Players cannot see the bonus until the round is drawn
--     (lucky_card_get_current_round() hides it), so a boost is invisible to them
--     while they bet.
--
-- RETURNS jsonb:
--   {"success": true,  "round_number": N, "bonus_multiplier": B}
--   {"success": false, "error": "invalid_bonus"}                       not 1..10 or NULL
--   {"success": false, "error": "round_not_found"}                     no round exists yet this cycle
--   {"success": false, "error": "already_drawn", "round_number": N}    too late
--
-- One small difference from Triple Chance: a NULL argument is refused as
-- invalid_bonus. The original's "NOT IN (1,2,3,4)" evaluates to NULL for a NULL
-- argument, so it falls through to the UPDATE and fails there with a not-null
-- error instead.
--
-- Service role only (the dashboard's server-side admin client), as the Triple
-- Chance original. No new error codes.
-- #############################################################################

BEGIN;

CREATE FUNCTION public.lucky_card_apply_bonus_to_current_round(p_bonus SMALLINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cycle   CONSTANT INT := 103;
  v_number  BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle;
  v_round   public.lucky_card_rounds;
BEGIN
  IF p_bonus IS NULL OR p_bonus < 1 OR p_bonus > 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_bonus');
  END IF;

  -- Row lock: serialises against lucky_card_draw_round()'s own FOR UPDATE on
  -- the same row, so no torn state is possible either way.
  SELECT * INTO v_round FROM public.lucky_card_rounds WHERE round_number = v_number FOR UPDATE;
  IF NOT FOUND THEN
    -- Nothing has created this cycle's round yet (no poll and no tick so far).
    RETURN jsonb_build_object('success', false, 'error', 'round_not_found');
  END IF;

  IF v_round.winning_rank IS NOT NULL THEN
    -- Already drawn: the one hard rule this feature depends on.
    RETURN jsonb_build_object('success', false, 'error', 'already_drawn', 'round_number', v_round.round_number);
  END IF;

  UPDATE public.lucky_card_rounds SET bonus_multiplier = p_bonus WHERE id = v_round.id;

  RETURN jsonb_build_object('success', true, 'round_number', v_round.round_number, 'bonus_multiplier', p_bonus);
END;
$fn$;

-- Internal: service_role only, mirroring the Triple Chance original's live ACL.
-- A client able to call this could change the payout of any running round.
-- Default privileges would otherwise grant EXECUTE to anon and authenticated
-- (Issue #120). CREATE OR REPLACE keeps these grants; DROP + CREATE does not.
REVOKE ALL ON FUNCTION public.lucky_card_apply_bonus_to_current_round(SMALLINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lucky_card_apply_bonus_to_current_round(SMALLINT) TO service_role;

COMMENT ON FUNCTION public.lucky_card_apply_bonus_to_current_round(SMALLINT) IS
  'Sets the bonus multiplier (1 to 10) of the Lucky Card round in progress, until '
  'it is drawn. Never touches lucky_card_config. Refuses once drawn. Internal; '
  'service_role only.';

COMMIT;
