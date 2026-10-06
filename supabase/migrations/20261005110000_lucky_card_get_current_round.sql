-- #############################################################################
-- LUCKY CARD - GAME FUNCTIONS 3 of 6: ROUND CREATION AND THE CURRENT-ROUND READ
-- Migration: 20261005110000_lucky_card_get_current_round.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 5 (bonus pinning), 6 (103 s timing), 14.16
-- #############################################################################
--
-- PURELY ADDITIVE. Creates one new function. Nothing belonging to Triple
-- Chance is altered, dropped, replaced or called; get_current_round() is
-- untouched. The body mirrors the live get_current_round() line for line,
-- pointed at the Lucky Card tables, with the two differences listed below.
--
-- WHAT IT DOES
-- ------------
-- This is the function the app polls. On every call it:
--   1. Works out which round the server clock is in: round_number is the
--      epoch second divided by 103, the same divisor Triple Chance uses, kept
--      in a separate table so the two games never share a round row.
--   2. Creates that round if no caller has yet, copying the RTP and the bonus
--      multiplier from lucky_card_config onto the round. Those two values are
--      then fixed for the round: a later dashboard change affects only rounds
--      created afterwards (spec 5).
--   3. Resets the bonus dial to 1 after it has been used once. Only the caller
--      whose INSERT actually created the round does this, and only if the dial
--      still holds the value that was just captured, so a newer admin change
--      made in the same instant is not overwritten.
--   4. From draw_at_second (89) onwards, draws the round if it has no result
--      and runs one settlement batch, until the round is settled.
--   5. Returns the round. winning_rank / winning_suit are NULL until the draw,
--      and bonus_multiplier is returned as NULL until the draw so a client
--      cannot learn the bonus while betting is open. The round's RTP is never
--      returned.
--
-- The clock is the database's, never the client's: a client cannot cause an
-- early draw by calling this, only a draw the schedule already allows.
--
-- TWO DELIBERATE DIFFERENCES FROM get_current_round()
-- --------------------------------------------------
--   * Once a round is 'settled' the draw/settle block is skipped. Triple
--     Chance calls settle_round() on every poll after the draw second, which
--     takes a row lock on the round each time only to learn there is nothing
--     to do. A settled round is final, so skipping it changes no outcome.
--   * The error note is prefixed 'lucky_card_get_current_round:' so its rows
--     in the shared audit_log are distinguishable from Triple Chance's.
--
-- SHARED OBJECT USED (permission given by the user 2026-10-05, option A)
-- ---------------------------------------------------------------------
-- public.audit_log: INSERT of one 'system' row when a draw or settlement
-- fails. Rows are only added. The table, its CHECK constraint, its policy and
-- every function that already writes to it are unchanged.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- It only ever touches the round the clock is in NOW. A round that nobody
-- polled after second 89 stays undrawn until the Lucky Card tick function
-- (function 5 of 6) picks it up; that function does not exist yet.
-- #############################################################################

BEGIN;

CREATE FUNCTION public.lucky_card_get_current_round()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cycle       CONSTANT INT := 103;
  v_now         BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_number      BIGINT := v_now / v_cycle;
  v_into        INT    := (v_now % v_cycle)::INT;
  v_left        INT    := v_cycle - (v_now % v_cycle)::INT;
  v_draw_at     INT;
  v_rtp         NUMERIC;
  v_bonus       SMALLINT;
  v_round       public.lucky_card_rounds;
  v_inserted_id UUID;
BEGIN
  SELECT draw_at_second, rtp_percentage, bonus_multiplier
    INTO v_draw_at, v_rtp, v_bonus
    FROM public.lucky_card_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.lucky_card_rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    -- Many clients reach a new round in the same second. ON CONFLICT lets
    -- exactly one INSERT win; the others fall through to the SELECT below.
    INSERT INTO public.lucky_card_rounds (round_number, scheduled_at, phase, rtp_percentage, bonus_multiplier)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting', v_rtp, v_bonus)
    ON CONFLICT (round_number) DO NOTHING
    RETURNING id INTO v_inserted_id;

    -- The bonus is a one-shot dial: it applies to the round just created and
    -- then returns to 1. Reset only by the caller that won the INSERT, and
    -- only if the dial still holds the captured value.
    IF v_inserted_id IS NOT NULL AND v_bonus != 1 THEN
      UPDATE public.lucky_card_config SET bonus_multiplier = 1, updated_at = NOW()
       WHERE id = 'global' AND bonus_multiplier = v_bonus;
    END IF;

    SELECT * INTO v_round FROM public.lucky_card_rounds WHERE round_number = v_number;
  END IF;

  IF v_into >= v_draw_at AND v_round.phase <> 'settled' THEN
    -- A failure here must never reach the caller: every connected player's
    -- device polls this function. The error is recorded and the round is
    -- returned as it stands, so the next poll or tick retries it.
    BEGIN
      IF v_round.winning_rank IS NULL THEN
        PERFORM public.lucky_card_draw_round(v_round.id);
      END IF;
      PERFORM public.lucky_card_settle_round(v_round.id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_log (actor_id, kind, detail)
      VALUES (NULL, 'system',
        format('lucky_card_get_current_round: round %s failed to draw/settle: %s', v_round.id, SQLERRM));
    END;
    SELECT * INTO v_round FROM public.lucky_card_rounds WHERE round_number = v_number;
  END IF;

  RETURN jsonb_build_object(
    'round_id',          v_round.id,
    'round_number',      v_round.round_number,
    'phase',             v_round.phase,
    'scheduled_at',      v_round.scheduled_at,
    'seconds_remaining', v_left,
    'seconds_into',      v_into,
    'draw_at_second',    v_draw_at,
    'winning_rank',      v_round.winning_rank,
    'winning_suit',      v_round.winning_suit,
    'bonus_multiplier',  CASE WHEN v_round.winning_rank IS NULL THEN NULL ELSE v_round.bonus_multiplier END
  );
END;
$fn$;

-- Callable by signed-in users and the server, mirroring get_current_round()'s
-- live ACL. Default privileges here would otherwise also grant EXECUTE to
-- anon (Issue #120), letting a visitor with no account create rounds.
-- CREATE OR REPLACE keeps these grants; DROP + CREATE does not.
REVOKE ALL ON FUNCTION public.lucky_card_get_current_round() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lucky_card_get_current_round() TO authenticated, service_role;

COMMENT ON FUNCTION public.lucky_card_get_current_round() IS
  'Returns the Lucky Card round the server clock is in, creating it (with RTP '
  'and bonus pinned from lucky_card_config) if needed, and drawing/settling it '
  'from draw_at_second onwards. Result and bonus are hidden until the draw. '
  'Signed-in users and service_role.';

COMMIT;
