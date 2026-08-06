-- Fix: draw_round could never draw a round that carried zero stake.
--
-- gen_random_bytes comes from pgcrypto, which Supabase installs into the
-- `extensions` schema. draw_round is SECURITY DEFINER pinned to
-- search_path=public, so the name did not resolve and the zero-stake
-- fallback raised: function gen_random_bytes(integer) does not exist.
--
-- The exception propagated out of get_current_round, so for any round with
-- no bets the client's RPC failed outright: the round was never drawn, the
-- wheel never spun, and the app displayed "NO INTERNET CONNECTION" while
-- the network was perfectly healthy. Only rounds that happened to carry
-- stake took the RTP branch and drew successfully — which is why exactly
-- 2 of the first 17 rounds ever produced a result.
--
-- Fully qualified rather than widening search_path, which would enlarge the
-- trusted name-resolution surface of a SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.draw_round(p_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round        public.rounds;
  v_rtp          NUMERIC;
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

  SELECT rtp_percentage INTO v_rtp FROM public.game_config WHERE id = 'global';

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
    v_target := v_stake * (v_rtp / 100.0);
    FOR v_r IN 0..9 LOOP
      FOR v_g IN 0..9 LOOP
        FOR v_b IN 0..9 LOOP
          v_payout := (v_s[v_b + 1] * 9.0)
                    + (v_d[(v_g * 10 + v_b) + 1] * 90.0)
                    + (v_t[(v_r * 100 + v_g * 10 + v_b) + 1] * 900.0);
          v_diff := abs(v_payout - v_target);
          IF v_best_diff IS NULL OR v_diff < v_best_diff THEN
            v_best_diff := v_diff;
            v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  ELSE
    v_best_r := (get_byte(extensions.gen_random_bytes(1), 0) % 10);
    v_best_g := (get_byte(extensions.gen_random_bytes(1), 0) % 10);
    v_best_b := (get_byte(extensions.gen_random_bytes(1), 0) % 10);
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
