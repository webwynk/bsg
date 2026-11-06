-- #############################################################################
-- TRIPLE CHANCE: FAIR DRAW v2, BEHIND A SWITCH (OFF)
-- Migration: 20261106110000_tc_fair_draw_v2.sql
-- Plan: docs/rtp_audit/TRIPLE_CHANCE_FAIR_DRAW_V2_PLAN.md (Hasan's Q1 to Q3)
-- #############################################################################
--
-- Installs the new Triple Chance draw without turning it on. Players see no
-- change until game_config.fair_draw_from_round is set to a round number.
--
--   tc_fair_chances(single, double, triple, rtp)  chance of each result 000-999
--   draw_round_v2(round)                          draws one round with them
--   draw_round(round)                             unchanged, plus a switch at the top
--   game_config.fair_draw_from_round              NULL = old draw (default)
--   RTP allowed 20 to 100 on game_config and rounds (was 50 to 100)
--
-- The rule works on the 1,000 results, because one result can pay a single (its
-- last digit), a double (its last two) and a triple at once. Per round, from that
-- round's coins only (phone bets and tickets together):
--   * Some result pays nobody, setting up to 90%: every result that pays
--     someone has chance setting/900, so a single wins setting/9, a double
--     setting/90 and a triple setting/900, and every bet averages the setting.
--     Results that pay nobody share the rest.
--   * Some result pays nobody, setting above 90%: lean equally toward every
--     result that pays someone.
--   * Every result pays someone (A2): weight 2 on the cheapest results and 1
--     on the rest, mixed with equal chances just enough to reach the setting;
--     never more than 2 times between results, equal payouts always equal
--     chances, never above the natural 90%.
--   * Every result pays someone and the setting is 90% or more, or all results
--     pay the same, or there are no bets: every result 1 in 1,000.
-- Settle, the bonus, the tickets and the bet limits are not touched.
--
-- Takes short ACCESS EXCLUSIVE locks on game_config and rounds: apply between
-- rounds, after the draw at 90 s and before the round ends at 103 s.
-- Rollback: scripts/tc_fair_draw_v2_rollback.sql
-- #############################################################################

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 1. The switch. NULL = the old draw for every round.
ALTER TABLE public.game_config ADD COLUMN fair_draw_from_round BIGINT;
COMMENT ON COLUMN public.game_config.fair_draw_from_round IS
  'Triple Chance Fair draw v2 is used from this round number on. NULL = the old draw.';

-- 2. RTP allowed 20 to 100 (Hasan, 2026-11-06), in both places it is checked.
ALTER TABLE public.game_config DROP CONSTRAINT game_config_rtp_percentage_check;
ALTER TABLE public.game_config ADD CONSTRAINT game_config_rtp_percentage_check
  CHECK (rtp_percentage >= 20 AND rtp_percentage <= 100);
ALTER TABLE public.rounds DROP CONSTRAINT rounds_rtp_percentage_check;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_rtp_percentage_check
  CHECK (rtp_percentage >= 20 AND rtp_percentage <= 100);

-- 3. The chance of each result 000 to 999 for one round. Index r+1 holds result r
--    (red*100 + green*10 + black), the same order draw_round uses. Pure maths.
CREATE FUNCTION public.tc_fair_chances(p_single BIGINT[], p_double BIGINT[], p_triple BIGINT[], p_rtp NUMERIC)
RETURNS NUMERIC[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_n       CONSTANT INT := 1000;
  v_pay     NUMERIC[] := ARRAY_FILL(0::NUMERIC, ARRAY[1000]);
  v_p       NUMERIC[] := ARRAY_FILL(0.001::NUMERIC, ARRAY[1000]);
  v_sorted  NUMERIC[];
  v_stake   NUMERIC := 0;
  v_total   NUMERIC := 0;
  v_mean    NUMERIC;
  v_target  NUMERIC;
  v_empty   INT := 0;
  v_paying  INT;
  v_pc      NUMERIC;
  v_lam     NUMERIC;
  v_meanp   NUMERIC;
  v_low     NUMERIC := 0;
  v_e       NUMERIC;
  v_best_e  NUMERIC := NULL;
  v_best_c  NUMERIC;
  v_best_k  INT;
  v_r       INT;
  v_k       INT;
BEGIN
  IF array_length(p_single, 1) IS DISTINCT FROM 10 OR array_length(p_double, 1) IS DISTINCT FROM 100
     OR array_length(p_triple, 1) IS DISTINCT FROM 1000 THEN
    RAISE EXCEPTION 'tc_fair_chances: need 10 singles, 100 doubles, 1000 triples' USING errcode = '22023';
  END IF;
  IF p_rtp IS NULL OR p_rtp < 20 OR p_rtp > 100 THEN
    RAISE EXCEPTION 'tc_fair_chances: RTP must be 20 to 100' USING errcode = '22023';
  END IF;

  FOR v_r IN 1..10 LOOP v_stake := v_stake + p_single[v_r]; END LOOP;
  FOR v_r IN 1..100 LOOP v_stake := v_stake + p_double[v_r]; END LOOP;
  FOR v_r IN 1..1000 LOOP v_stake := v_stake + p_triple[v_r]; END LOOP;
  IF v_stake = 0 THEN
    RETURN v_p;                                         -- no bets: 1 in 1,000 each
  END IF;

  FOR v_r IN 0..999 LOOP
    v_pay[v_r + 1] := p_single[(v_r % 10) + 1] * 9
                    + p_double[(v_r % 100) + 1] * 90
                    + p_triple[v_r + 1] * 900;
    IF v_pay[v_r + 1] < 0 THEN
      RAISE EXCEPTION 'tc_fair_chances: negative coins' USING errcode = '22023';
    END IF;
    v_total := v_total + v_pay[v_r + 1];
    IF v_pay[v_r + 1] = 0 THEN v_empty := v_empty + 1; END IF;
  END LOOP;

  v_paying := v_n - v_empty;
  v_mean   := v_total / v_n;
  v_target := v_stake * p_rtp / 100;

  IF v_empty > 0 THEN
    IF v_target <= v_mean THEN
      v_pc := (p_rtp / 100) / 900;
      FOR v_r IN 1..v_n LOOP
        v_p[v_r] := CASE WHEN v_pay[v_r] > 0 THEN v_pc ELSE (1 - v_pc * v_paying) / v_empty END;
      END LOOP;
    ELSE
      v_meanp := v_total / v_paying;
      v_lam := LEAST(1, (v_target - v_mean) / (v_meanp - v_mean));
      FOR v_r IN 1..v_n LOOP
        v_p[v_r] := (1 - v_lam) / v_n + CASE WHEN v_pay[v_r] > 0 THEN v_lam / v_paying ELSE 0 END;
      END LOOP;
    END IF;
    RETURN v_p;
  END IF;

  -- Every result pays someone.
  SELECT array_agg(x ORDER BY x) INTO v_sorted FROM unnest(v_pay) AS x;
  IF v_target >= v_mean OR v_sorted[1] = v_sorted[v_n] THEN
    RETURN v_p;                                         -- 1 in 1,000 each
  END IF;

  -- A2: try each payout level as the cut (results at or below it weigh 2, the
  -- rest 1, so equal payouts weigh the same) and keep the cheapest mix.
  FOR v_k IN 1..(v_n - 1) LOOP
    v_low := v_low + v_sorted[v_k];
    CONTINUE WHEN v_sorted[v_k] = v_sorted[v_k + 1];
    v_e := (v_total + v_low) / (v_n + v_k);
    IF v_best_e IS NULL OR v_e < v_best_e THEN
      v_best_e := v_e; v_best_c := v_sorted[v_k]; v_best_k := v_k;
    END IF;
  END LOOP;

  v_lam := LEAST(1, (v_mean - v_target) / (v_mean - v_best_e));
  FOR v_r IN 1..v_n LOOP
    v_p[v_r] := (1 - v_lam) / v_n
              + v_lam * (CASE WHEN v_pay[v_r] <= v_best_c THEN 2 ELSE 1 END)::NUMERIC / (v_n + v_best_k);
  END LOOP;
  RETURN v_p;
END;
$$;

-- 4. Draws one Triple Chance round with Fair draw v2: the same steps and writes as
--    the old draw; only the choice of result differs.
CREATE FUNCTION public.draw_round_v2(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round   public.rounds;
  v_stake   BIGINT := 0;
  v_s       BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[10]);
  v_d       BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[100]);
  v_t       BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[1000]);
  v_bet     RECORD;
  v_k       TEXT;
  v_v       BIGINT;
  v_p       NUMERIC[];
  v_b       BYTEA;
  v_roll    NUMERIC;
  v_acc     NUMERIC := 0;
  v_res     INT := 999;
  v_i       INT;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.red IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true,
      'red', v_round.red, 'green', v_round.green, 'black', v_round.black);
  END IF;

  -- Phone bets and tickets together, exactly as the old draw adds them.
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

  v_p := public.tc_fair_chances(v_s, v_d, v_t, v_round.rtp_percentage);

  -- One secure roll from 0 to just under 1 (32 random bits).
  v_b := extensions.gen_random_bytes(4);
  v_roll := ((get_byte(v_b, 0)::NUMERIC * 16777216) + (get_byte(v_b, 1) * 65536)
           + (get_byte(v_b, 2) * 256) + get_byte(v_b, 3)) / 4294967296;
  FOR v_i IN 1..1000 LOOP
    v_acc := v_acc + v_p[v_i];
    IF v_roll < v_acc THEN
      v_res := v_i - 1;
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.rounds
     SET red = v_res / 100, green = (v_res / 10) % 10, black = v_res % 10,
         phase = 'drawing', total_stake = v_stake, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('red', v_res / 100, 'green', (v_res / 10) % 10, 'black', v_res % 10,
                            'total_stake', v_stake, 'rule', 'v2');
END;
$$;

-- 5. The old draw, unchanged except the switch.
CREATE OR REPLACE FUNCTION public.draw_round(p_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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

  -- Fair draw v2 (20261106110000): rounds from game_config.fair_draw_from_round
  -- on are drawn by draw_round_v2. NULL (the default) keeps this rule.
  IF EXISTS (SELECT 1 FROM public.game_config
              WHERE id = 'global'
                AND fair_draw_from_round IS NOT NULL
                AND v_round.round_number >= fair_draw_from_round) THEN
    RETURN public.draw_round_v2(p_round_id);
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
          -- Payout multiplier is permanent (single x9 / double x90 / triple
          -- x900) -- no longer read from anywhere, never configurable again.
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
$$;

REVOKE ALL ON FUNCTION public.tc_fair_chances(BIGINT[], BIGINT[], BIGINT[], NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.draw_round_v2(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tc_fair_chances(BIGINT[], BIGINT[], BIGINT[], NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.draw_round_v2(UUID) TO service_role;

COMMENT ON FUNCTION public.tc_fair_chances(BIGINT[], BIGINT[], BIGINT[], NUMERIC) IS
  'Triple Chance Fair draw v2: the chance of each result 000 to 999 for one round, from its coins and RTP.';
COMMENT ON FUNCTION public.draw_round_v2(UUID) IS
  'Triple Chance Fair draw v2: draws one round. Used by draw_round when the switch is on.';

COMMIT;
