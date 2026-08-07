-- Issue #13 (MASTER_AUDIT_AND_REMEDIATION_PLAN.md): Modulo Bias in CSPRNG Digit
-- Generation, inside draw_round().
--
-- Two sites in draw_round() reduced a random byte/word to a smaller range using
-- plain `%`, which is only unbiased when the source range is an exact multiple
-- of the target range. Neither was:
--
--   1. Zero-stake fallback (no one bet on the round, so there is no RTP target
--      to aim for -- three digits are picked purely at random):
--         get_byte(gen_random_bytes(1), 0) % 10
--      A byte is 0..255 (256 values). 256 is not divisible by 10, so digits
--      0-5 land on 26/256 of byte values while digits 6-9 land on only 25/256
--      -- a small but real, permanent skew toward low digits on every
--      zero-stake round.
--
--   2. Reservoir-sampling tie-break (introduced by
--      20260807150000_fix_draw_round_rtp_reservoir_sampling.sql to fix the
--      '000'-always-wins bug when multiple outcomes tie for the RTP target):
--         v_rnd % v_tied_count
--      v_rnd is drawn from a 65,536-value range, which is not generally a
--      multiple of v_tied_count either. Much smaller than site 1 (bounded
--      under ~1.5% even in a worst-case 1,000-way tie), but the same class of
--      bug, so it is fixed here in the same deployment.
--
-- Fix: rejection sampling -- draw a random value, and if it lands in the
-- leftover, not-evenly-divisible remainder at the top of the range, discard it
-- and draw again. This guarantees a perfectly uniform result. Redraw rate is
-- ~2.3% worst case for the digit helper and negligible for the index helper,
-- so the added CSPRNG cost is immaterial.
--
-- This migration does not change RTP targeting, payout math, or the
-- reservoir-sampling algorithm itself -- only how the underlying random
-- numbers are generated. Behavior for every non-tied, staked round is
-- unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.random_digit_unbiased()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_byte INT;
BEGIN
  LOOP
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    EXIT WHEN v_byte < 250; -- 250 = largest multiple of 10 <= 256; reject 250-255
  END LOOP;
  RETURN v_byte % 10;
END;
$$;

CREATE OR REPLACE FUNCTION public.random_index_unbiased(p_n INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_val INT; v_limit INT;
BEGIN
  v_limit := (65536 / p_n) * p_n; -- largest multiple of p_n <= 65536
  LOOP
    v_val := (get_byte(extensions.gen_random_bytes(2), 0) * 256) + get_byte(extensions.gen_random_bytes(2), 1);
    EXIT WHEN v_val < v_limit;
  END LOOP;
  RETURN v_val % p_n;
END;
$$;

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
            v_best_diff  := v_diff;
            v_tied_count := 1;
            v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
          ELSIF v_diff = v_best_diff THEN
            v_tied_count := v_tied_count + 1;
            -- Unbiased reservoir sampling: select the new candidate with
            -- exact probability 1 / v_tied_count via rejection sampling
            -- (was: v_rnd % v_tied_count, which had a small modulo bias).
            IF public.random_index_unbiased(v_tied_count) = 0 THEN
              v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  ELSE
    -- No one bet on this round -- pick three digits uniformly at random.
    -- Was: get_byte(gen_random_bytes(1), 0) % 10, which biased digits 0-5
    -- over 6-9. Now unbiased via rejection sampling.
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
