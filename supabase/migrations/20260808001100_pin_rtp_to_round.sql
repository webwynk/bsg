-- Issue #43 follow-up: pin rtp_percentage onto each round at creation, the
-- exact same treatment already applied to the payout multiplier
-- (20260808001000_pin_payout_multiplier_to_round.sql).
--
-- Root cause, confirmed by direct trace with the user: place_bet() never
-- looks at RTP at all -- it plays no role in accepting a bet. RTP only
-- matters once, later, when draw_round() reads game_config.rtp_percentage
-- LIVE, at the exact instant the draw fires. A superadmin can change RTP at
-- any point during a round -- no lock, no round-boundary check -- and
-- whatever value happens to be live at the single instant the draw fires is
-- what governs that round's outcome, completely disconnected from whatever
-- was live when players actually placed their bets earlier in that same
-- round.
--
-- Unlike the multiplier bug, this was never a draw-vs-settle disagreement
-- (settle_round never reads RTP at all, and draw_round only reads it once,
-- atomically) -- but it is the same fairness problem: the rate a round
-- actually gets judged against can differ from the rate that was live when
-- players committed their bets to it.
--
-- Fix: every round now carries its own fixed rtp_percentage, captured once,
-- at creation, exactly like the multiplier. draw_round() reads it from the
-- round from now on -- at which point draw_round no longer needs to read
-- game_config at all for anything.

BEGIN;

ALTER TABLE public.rounds
  ADD COLUMN rtp_percentage NUMERIC(5,2) NOT NULL DEFAULT 96.00 CHECK (rtp_percentage BETWEEN 50 AND 100);

-- get_current_round(): captures the live RTP onto the round at creation,
-- alongside the multiplier capture already added.
CREATE OR REPLACE FUNCTION public.get_current_round()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle    CONSTANT INT := 103;
  v_now      BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_number   BIGINT := v_now / v_cycle;
  v_into     INT    := (v_now % v_cycle)::INT;
  v_left     INT    := v_cycle - (v_now % v_cycle)::INT;
  v_draw_at  INT;
  v_rtp      NUMERIC;
  v_mult_s   NUMERIC; v_mult_d NUMERIC; v_mult_t NUMERIC;
  v_round    public.rounds;
BEGIN
  SELECT draw_at_second, rtp_percentage,
         payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple
    INTO v_draw_at, v_rtp, v_mult_s, v_mult_d, v_mult_t
    FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage,
                               payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting', v_rtp,
            v_mult_s, v_mult_d, v_mult_t)
    ON CONFLICT (round_number) DO NOTHING;
    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  IF v_into >= v_draw_at THEN
    IF v_round.red IS NULL THEN
      PERFORM public.draw_round(v_round.id);
    END IF;
    PERFORM public.settle_round(v_round.id);
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
    'black',             v_round.black
  );
END;
$$;

-- tick_rounds(): same treatment for the scheduled backup path.
CREATE OR REPLACE FUNCTION public.tick_rounds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle    CONSTANT INT := 103;
  v_now      BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_current  BIGINT := v_now / v_cycle;
  v_into     INT    := (v_now % v_cycle)::INT;
  v_draw_at  INT;
  v_rtp      NUMERIC;
  v_mult_s   NUMERIC; v_mult_d NUMERIC; v_mult_t NUMERIC;
  v_r        RECORD;
  v_drawn    INT := 0;
  v_settled  INT := 0;
BEGIN
  SELECT draw_at_second, rtp_percentage,
         payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple
    INTO v_draw_at, v_rtp, v_mult_s, v_mult_d, v_mult_t
    FROM public.game_config WHERE id = 'global';

  -- Create the current round even when nobody is online, so the round history
  -- stays continuous instead of gapping whenever no player is connected.
  INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage,
                             payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple)
  VALUES (v_current, to_timestamp((v_current + 1) * v_cycle), 'betting', v_rtp,
          v_mult_s, v_mult_d, v_mult_t)
  ON CONFLICT (round_number) DO NOTHING;

  -- Every round whose draw time has passed and which is not yet fully settled.
  -- Covers both the steady state (the round just now reaching T+94) and any
  -- backlog left by an outage.
  --
  -- LIMIT 20 bounds the work per tick. A large backlog drains over successive
  -- ticks a few seconds apart rather than stalling one very long transaction;
  -- draw_round scans all 1,000 combinations per round, so an unbounded catch-up
  -- after a long outage could otherwise run for minutes while holding locks.
  FOR v_r IN
    SELECT id, red
      FROM public.rounds
     WHERE (round_number < v_current
            OR (round_number = v_current AND v_into >= v_draw_at))
       AND (red IS NULL OR phase <> 'settled')
     ORDER BY round_number
     LIMIT 20
  LOOP
    -- Both are idempotent: draw_round returns already_drawn when red is set,
    -- settle_round returns not_drawn when it is not, and only ever touches
    -- bets with is_settled = false.
    IF v_r.red IS NULL THEN
      PERFORM public.draw_round(v_r.id);
      v_drawn := v_drawn + 1;
    END IF;
    PERFORM public.settle_round(v_r.id);
    v_settled := v_settled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'round_number', v_current,
    'seconds_into', v_into,
    'drawn',        v_drawn,
    'settled',      v_settled
  );
END;
$function$;

-- draw_round(): RTP-target calculation now reads the multiplier AND rtp
-- from the round's own pinned values. game_config is no longer read at all
-- in this function.
CREATE OR REPLACE FUNCTION public.draw_round(p_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round        public.rounds;
  v_stake        BIGINT := 0;
  v_target       NUMERIC;
  v_s            BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[10]);
  v_d            BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[100]);
  v_t            BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[1000]);
  v_bet          RECORD;
  v_k            TEXT;
  v_v            BIGINT;
  v_r INT; v_g INT; v_b INT;
  v_payout       NUMERIC;
  v_diff         NUMERIC;
  v_best_diff    NUMERIC := NULL;
  v_tied_count   INT := 0;
  v_best_r INT := 0; v_best_g INT := 0; v_best_b INT := 0;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.red IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true,
      'red', v_round.red, 'green', v_round.green, 'black', v_round.black);
  END IF;

  FOR v_bet IN SELECT single_bets, double_bets, triple_bets, total_stake
                 FROM public.bets WHERE round_id = p_round_id
  LOOP
    v_stake := v_stake + v_bet.total_stake;
    FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(v_bet.single_bets) LOOP
      v_s[v_k::INT + 1] := v_s[v_k::INT + 1] + v_v;
    END LOOP;
    FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(v_bet.double_bets) LOOP
      v_d[v_k::INT + 1] := v_d[v_k::INT + 1] + v_v;
    END LOOP;
    FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(v_bet.triple_bets) LOOP
      v_t[v_k::INT + 1] := v_t[v_k::INT + 1] + v_v;
    END LOOP;
  END LOOP;

  IF v_stake > 0 THEN
    v_target := v_stake * (v_round.rtp_percentage / 100.0);
    FOR v_r IN 0..9 LOOP
      FOR v_g IN 0..9 LOOP
        FOR v_b IN 0..9 LOOP
          v_payout := (v_s[v_b + 1] * v_round.payout_multiplier_single)
                    + (v_d[(v_g * 10 + v_b) + 1] * v_round.payout_multiplier_double)
                    + (v_t[(v_r * 100 + v_g * 10 + v_b) + 1] * v_round.payout_multiplier_triple);
          v_diff := abs(v_payout - v_target);

          IF v_best_diff IS NULL OR v_diff < v_best_diff THEN
            v_best_diff  := v_diff;
            v_tied_count := 1;
            v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
          ELSIF v_diff = v_best_diff THEN
            v_tied_count := v_tied_count + 1;
            IF public.random_index_unbiased(v_tied_count) = 0 THEN
              v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  ELSE
    v_best_r := public.random_digit_unbiased();
    v_best_g := public.random_digit_unbiased();
    v_best_b := public.random_digit_unbiased();
  END IF;

  UPDATE public.rounds
     SET red = v_best_r, green = v_best_g, black = v_best_b,
         phase = 'drawing', total_stake = v_stake, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('red', v_best_r, 'green', v_best_g, 'black', v_best_b,
                            'total_stake', v_stake);
END;
$function$
;

COMMIT;
