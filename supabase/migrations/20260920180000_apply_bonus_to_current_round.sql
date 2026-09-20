-- Issue #99: Admin can now boost the round already in progress ("this
-- round"), not just the next one, plus the sticky dial (game_config)
-- auto-resets to N the instant a round actually consumes it.
--
-- Two independent capabilities, deliberately kept on separate tracks so
-- they can never bleed into each other:
--
-- 1. apply_bonus_to_current_round(p_bonus) -- writes DIRECTLY to the
--    already-existing current round's own rounds.bonus_multiplier column.
--    Never touches game_config. Guarded: only allowed while that round has
--    not yet been drawn (red IS NULL) -- the same safety boundary already
--    proven for the rest of this feature. Uses the same SELECT ... FOR
--    UPDATE row-lock pattern draw_round()/settle_round() already rely on,
--    so it can never race against a draw happening at the same instant.
--
-- 2. get_current_round()/tick_rounds(): when a NEW round is born and
--    captures whatever the dial (game_config.bonus_multiplier) currently
--    says, the dial is immediately reset back to 1 (N) -- a bonus is now a
--    one-shot nudge for whichever round grabs it, not a sticky setting an
--    admin has to remember to turn off. Only the caller that actually won
--    the round-creation race performs the reset (via `RETURNING id INTO
--    v_inserted_id`, checked before resetting), and only if nobody changed
--    the dial again since it was read moments earlier (`WHERE
--    bonus_multiplier = v_bonus`) -- never clobbers a genuinely newer admin
--    change made in the same narrow window.
--
-- Deliberately NOT done: capability 1 does NOT also write to game_config.
-- An earlier design draft did, to make the dashboard "reflect" the boost --
-- traced through and found this would let the boost silently leak into the
-- round AFTER the one actually boosted (the dial wouldn't reset until the
-- NEXT round is created, which happens well after the current round is
-- already boosted directly, so that next round would inherit the same
-- value nobody intended it to have). The dashboard instead reads the
-- current round's own value directly (a new field in
-- getActiveRoundTimingAction, next step) rather than through this table.
--
-- draw_round(), settle_round(), get_play_limits(): zero changes. settle_round
-- already reads whichever value ends up in a round's own bonus_multiplier
-- column, however it got there -- this migration only changes WHEN/HOW that
-- column can be written, never how it's read or applied to payouts.

BEGIN;

-- Capability 1: direct, current-round-only boost.
CREATE OR REPLACE FUNCTION public.apply_bonus_to_current_round(p_bonus SMALLINT)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle   CONSTANT INT := 103;
  v_number  BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle;
  v_round   public.rounds;
BEGIN
  IF p_bonus NOT IN (1, 2, 3, 4) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_bonus');
  END IF;

  -- Row lock: serializes correctly against draw_round()'s own FOR UPDATE on
  -- the same row -- whichever of the two gets there first wins cleanly, no
  -- torn state possible either way.
  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number FOR UPDATE;
  IF NOT FOUND THEN
    -- Round row doesn't exist yet this cycle (nothing has lazily created it
    -- via get_current_round()/tick_rounds() yet) -- nothing to boost.
    RETURN jsonb_build_object('success', false, 'error', 'round_not_found');
  END IF;

  IF v_round.red IS NOT NULL THEN
    -- Already drawn -- the one hard safety rule this whole feature depends
    -- on. Refused unconditionally, no exceptions.
    RETURN jsonb_build_object('success', false, 'error', 'already_drawn', 'round_number', v_round.round_number);
  END IF;

  UPDATE public.rounds SET bonus_multiplier = p_bonus WHERE id = v_round.id;

  RETURN jsonb_build_object('success', true, 'round_number', v_round.round_number, 'bonus_multiplier', p_bonus);
END;
$function$;

-- Capability 2a: get_current_round() -- auto-reset the dial the instant a
-- newly-created round actually consumes it. Everything else in this
-- function (draw/settle trigger, fault isolation, response shape) is
-- byte-for-byte unchanged from the current live version.
CREATE OR REPLACE FUNCTION public.get_current_round()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle       CONSTANT INT := 103;
  v_now         BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_number      BIGINT := v_now / v_cycle;
  v_into        INT    := (v_now % v_cycle)::INT;
  v_left        INT    := v_cycle - (v_now % v_cycle)::INT;
  v_draw_at     INT;
  v_rtp         NUMERIC;
  v_bonus       SMALLINT;
  v_round       public.rounds;
  v_inserted_id UUID;
BEGIN
  SELECT draw_at_second, rtp_percentage, bonus_multiplier
    INTO v_draw_at, v_rtp, v_bonus
    FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage, bonus_multiplier)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting', v_rtp, v_bonus)
    ON CONFLICT (round_number) DO NOTHING
    RETURNING id INTO v_inserted_id;

    -- One-shot nudge, not a sticky setting (Issue #99) -- only the caller
    -- that actually won the insert race resets it (avoids redundant/racy
    -- resets from callers who lost the ON CONFLICT race), and only if the
    -- dial still says what we just captured (avoids clobbering a genuinely
    -- newer admin change made in the same narrow window).
    IF v_inserted_id IS NOT NULL AND v_bonus != 1 THEN
      UPDATE public.game_config SET bonus_multiplier = 1, updated_at = NOW()
       WHERE id = 'global' AND bonus_multiplier = v_bonus;
    END IF;

    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  IF v_into >= v_draw_at THEN
    -- Issue #14 fix (unchanged): a failure here must never propagate --
    -- every connected player's device calls this every 2 seconds.
    BEGIN
      IF v_round.red IS NULL THEN
        PERFORM public.draw_round(v_round.id);
      END IF;
      PERFORM public.settle_round(v_round.id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_log (actor_id, kind, detail)
      VALUES (NULL, 'system',
        format('get_current_round: round %s failed to draw/settle: %s', v_round.id, SQLERRM));
    END;
    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  RETURN jsonb_build_object(
    'round_id',          v_round.id,
    'round_number',      v_round.round_number,
    'phase',             v_round.phase,
    'scheduled_at',      v_round.scheduled_at,
    'seconds_remaining', v_left,
    'seconds_into',      v_into,
    'draw_at_second',    v_draw_at,
    'red',               v_round.red,
    'green',             v_round.green,
    'black',             v_round.black,
    'bonus_multiplier',  CASE WHEN v_round.red IS NULL THEN NULL ELSE v_round.bonus_multiplier END
  );
END;
$function$;

-- Capability 2b: tick_rounds() -- identical treatment for the scheduled
-- backup round-creation path. Draw/settle loop, LIMIT 20 batching, and
-- fault isolation are all unchanged.
CREATE OR REPLACE FUNCTION public.tick_rounds()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle       CONSTANT INT := 103;
  v_now         BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_current     BIGINT := v_now / v_cycle;
  v_into        INT    := (v_now % v_cycle)::INT;
  v_draw_at     INT;
  v_rtp         NUMERIC;
  v_bonus       SMALLINT;
  v_r           RECORD;
  v_drawn       INT := 0;
  v_settled     INT := 0;
  v_failed      INT := 0;
  v_inserted_id UUID;
BEGIN
  SELECT draw_at_second, rtp_percentage, bonus_multiplier
    INTO v_draw_at, v_rtp, v_bonus
    FROM public.game_config WHERE id = 'global';

  INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage, bonus_multiplier)
  VALUES (v_current, to_timestamp((v_current + 1) * v_cycle), 'betting', v_rtp, v_bonus)
  ON CONFLICT (round_number) DO NOTHING
  RETURNING id INTO v_inserted_id;

  -- Same one-shot auto-reset as get_current_round() above.
  IF v_inserted_id IS NOT NULL AND v_bonus != 1 THEN
    UPDATE public.game_config SET bonus_multiplier = 1, updated_at = NOW()
     WHERE id = 'global' AND bonus_multiplier = v_bonus;
  END IF;

  FOR v_r IN
    SELECT id, red
      FROM public.rounds
     WHERE (round_number < v_current
            OR (round_number = v_current AND v_into >= v_draw_at))
       AND (red IS NULL OR phase <> 'settled')
     ORDER BY round_number
     LIMIT 20
  LOOP
    BEGIN
      IF v_r.red IS NULL THEN
        PERFORM public.draw_round(v_r.id);
        v_drawn := v_drawn + 1;
      END IF;
      PERFORM public.settle_round(v_r.id);
      v_settled := v_settled + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.audit_log (actor_id, kind, detail)
      VALUES (NULL, 'system',
        format('tick_rounds: round %s failed to draw/settle: %s', v_r.id, SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'round_number', v_current,
    'seconds_into', v_into,
    'drawn',        v_drawn,
    'settled',      v_settled,
    'failed',       v_failed
  );
END;
$function$;

COMMIT;
