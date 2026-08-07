-- Issue #5 (MASTER_AUDIT_AND_REMEDIATION_PLAN.md): Payout multiplier
-- (single/double/triple = x9/x90/x900) was hardcoded as a literal in FOUR
-- independent places, confirmed by direct source reading:
--   1. draw_round()   -- RTP-target calculation (which number "should" win)
--   2. settle_round() -- ACTUAL payout, moves real coins via apply_coin_movement
--   3. bsg_app/lib/providers/game_provider.dart -- client-side win prediction
--   4. bsg_app/lib/widgets/overlays/info_dialog.dart -- in-app payout explainer
--
-- No single source of truth existed anywhere (unlike play_limits, which the
-- app already fetches live). Changing the payout rate required editing two
-- separate SQL functions AND shipping a mobile app store release, with zero
-- mechanism preventing the four copies from silently drifting apart from each
-- other -- e.g. draw_round's RTP-targeting multiplier and settle_round's
-- actual-payout multiplier disagreeing, which would make the game target one
-- payout ratio while actually paying a different one.
--
-- Fix: move the multiplier into game_config (the same table rtp_percentage
-- already lives in) as the single source of truth. Both draw_round and
-- settle_round now read from it. get_play_limits() exposes it to the app,
-- which stops hardcoding it client-side.
--
-- This migration is a no-op for existing gameplay math: defaults (9.0 / 90.0
-- / 900.0) are byte-for-byte identical to the literals being replaced.

BEGIN;

ALTER TABLE public.game_config
  ADD COLUMN payout_multiplier_single NUMERIC(8,2) NOT NULL DEFAULT 9.0   CHECK (payout_multiplier_single > 0),
  ADD COLUMN payout_multiplier_double NUMERIC(8,2) NOT NULL DEFAULT 90.0  CHECK (payout_multiplier_double > 0),
  ADD COLUMN payout_multiplier_triple NUMERIC(8,2) NOT NULL DEFAULT 900.0 CHECK (payout_multiplier_triple > 0);

-- draw_round: RTP-target calculation now reads multipliers from config
-- instead of hardcoded literals. Everything else (including the Issue #13
-- unbiased-random fix already in production) is unchanged.
CREATE OR REPLACE FUNCTION public.draw_round(p_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round        public.rounds;
  v_cfg          public.game_config;
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

  SELECT * INTO v_cfg FROM public.game_config WHERE id = 'global';

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
    v_target := v_stake * (v_cfg.rtp_percentage / 100.0);
    FOR v_r IN 0..9 LOOP
      FOR v_g IN 0..9 LOOP
        FOR v_b IN 0..9 LOOP
          v_payout := (v_s[v_b + 1] * v_cfg.payout_multiplier_single)
                    + (v_d[(v_g * 10 + v_b) + 1] * v_cfg.payout_multiplier_double)
                    + (v_t[(v_r * 100 + v_g * 10 + v_b) + 1] * v_cfg.payout_multiplier_triple);
          v_diff := abs(v_payout - v_target);

          IF v_best_diff IS NULL OR v_diff < v_best_diff THEN
            v_best_diff  := v_diff;
            v_tied_count := 1;
            v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
          ELSIF v_diff = v_best_diff THEN
            v_tied_count := v_tied_count + 1;
            -- Unbiased reservoir sampling (Issue #13) -- unchanged by this migration.
            IF public.random_index_unbiased(v_tied_count) = 0 THEN
              v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  ELSE
    -- No one bet on this round -- unbiased random digits (Issue #13), unchanged.
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

-- settle_round: ACTUAL payout now reads the SAME multipliers as draw_round
-- from the same config row -- this is the function that moves real money via
-- apply_coin_movement, so it must never diverge from draw_round's copy again.
CREATE OR REPLACE FUNCTION public.settle_round(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round   public.rounds;
  v_cfg     public.game_config;
  v_bet     public.bets;
  v_s_key   TEXT; v_d_key TEXT; v_t_key TEXT;
  v_s BIGINT; v_d BIGINT; v_t BIGINT; v_total BIGINT;
  v_count   INT := 0;
  v_paid    BIGINT := 0;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.red IS NULL THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'not_drawn');
  END IF;

  SELECT * INTO v_cfg FROM public.game_config WHERE id = 'global';

  -- One canonical key form. place_bet guarantees keys are stored zero-padded,
  -- so no fallback lookups are needed.
  v_s_key := v_round.black::TEXT;
  v_d_key := v_round.green::TEXT || v_round.black::TEXT;
  v_t_key := v_round.red::TEXT || v_round.green::TEXT || v_round.black::TEXT;

  FOR v_bet IN SELECT * FROM public.bets
                WHERE round_id = p_round_id AND NOT is_settled FOR UPDATE
  LOOP
    v_s := (COALESCE((v_bet.single_bets ->> v_s_key)::BIGINT, 0) * v_cfg.payout_multiplier_single)::BIGINT;
    v_d := (COALESCE((v_bet.double_bets ->> v_d_key)::BIGINT, 0) * v_cfg.payout_multiplier_double)::BIGINT;
    v_t := (COALESCE((v_bet.triple_bets ->> v_t_key)::BIGINT, 0) * v_cfg.payout_multiplier_triple)::BIGINT;
    v_total := v_s + v_d + v_t;

    UPDATE public.bets
       SET single_payout = v_s, double_payout = v_d, triple_payout = v_t,
           total_payout  = v_total, is_settled = true, settled_at = NOW()
     WHERE id = v_bet.id;

    IF v_total > 0 THEN
      PERFORM public.apply_coin_movement(v_bet.user_id, NULL, 'payout', v_total, p_round_id);
      v_paid := v_paid + v_total;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.rounds
     SET phase = 'settled', total_payout = total_payout + v_paid, settled_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('settled', v_count, 'paid', v_paid);
END;
$$;

-- Expose the multipliers to clients via the existing limits RPC (no new
-- grant needed -- same function, same callers, just a richer payload).
CREATE OR REPLACE FUNCTION public.get_play_limits()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE v public.play_limits; c public.game_config;
BEGIN
  SELECT * INTO v FROM public.play_limits WHERE id = 'global';
  SELECT * INTO c FROM public.game_config WHERE id = 'global';
  RETURN jsonb_build_object(
    'single', jsonb_build_object('min', v.single_min, 'max', v.single_max, 'multiplier', c.payout_multiplier_single),
    'double', jsonb_build_object('min', v.double_min, 'max', v.double_max, 'multiplier', c.payout_multiplier_double),
    'triple', jsonb_build_object('min', v.triple_min, 'max', v.triple_max, 'multiplier', c.payout_multiplier_triple)
  );
END;
$$;

COMMIT;
