-- #############################################################################
-- SPIN2WIN: FAIR DRAW v2, BEHIND A SWITCH (OFF)
-- Migration: 20261106100000_spin2win_fair_draw_v2.sql
-- Plan: docs/rtp_audit/SPIN2WIN_FAIR_DRAW_V2_PLAN.md (Hasan's decisions 1 to 8)
-- #############################################################################
--
-- Installs the new Spin2Win draw without turning it on. Players see no change
-- until spin2win_config.fair_draw_from_round is set to a round number.
--
--   spin2win_fair_chances(coins, rtp)  the chance of each number, pure maths
--   spin2win_draw_round_v2(round)      draws one round with those chances
--   spin2win_draw_round(round)         unchanged, plus a switch at the top
--   spin2win_config.fair_draw_from_round   NULL = old draw (default)
--   RTP allowed 20 to 100 on spin2win_config and spin2win_rounds (was 30 to 100)
--
-- The new rule, per round, from that round's coins only (phone bets and
-- tickets added together):
--   * Some number has no coins, setting up to 90%: every number with coins
--     has chance setting/9; the empty numbers share the rest equally.
--   * Some number has no coins, setting above 90%: the chances lean equally
--     toward every number with coins, so the round still averages the setting.
--   * Every number has coins (A2): weight 2 on the cheapest numbers and 1 on
--     the rest, mixed with equal chances just enough to reach the setting.
--     No number is ever more than twice as likely as another, numbers with
--     equal coins always get equal chances, and the round never pays more
--     than the natural 90%.
--   * Every number has coins and the setting is 90% or more, or every number
--     has equal coins, or there are no bets: every number 10%.
-- Settle, the bonus, the tickets and the bet limits are not touched.
--
-- Takes short ACCESS EXCLUSIVE locks on spin2win_config and spin2win_rounds:
-- apply between rounds, after a draw and before the next cutoff.
-- Rollback: scripts/spin2win_fair_draw_v2_rollback.sql
-- #############################################################################

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 1. The switch. NULL = the old draw for every round.
ALTER TABLE public.spin2win_config ADD COLUMN fair_draw_from_round BIGINT;
COMMENT ON COLUMN public.spin2win_config.fair_draw_from_round IS
  'Fair draw v2 is used from this Spin2Win round number on. NULL = the old draw.';

-- 2. RTP allowed 20 to 100 (Hasan, 2026-11-06), in both places it is checked.
ALTER TABLE public.spin2win_config DROP CONSTRAINT spin2win_config_rtp_percentage_check;
ALTER TABLE public.spin2win_config ADD CONSTRAINT spin2win_config_rtp_percentage_check
  CHECK (rtp_percentage >= 20 AND rtp_percentage <= 100);
ALTER TABLE public.spin2win_rounds DROP CONSTRAINT spin2win_rounds_rtp_percentage_check;
ALTER TABLE public.spin2win_rounds ADD CONSTRAINT spin2win_rounds_rtp_percentage_check
  CHECK (rtp_percentage >= 20 AND rtp_percentage <= 100);

-- 3. The chance of each number 0 to 9 for one round. Pure maths, no table read.
CREATE FUNCTION public.spin2win_fair_chances(p_coins BIGINT[], p_rtp NUMERIC)
RETURNS NUMERIC[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_n       CONSTANT INT := 10;
  v_rate    CONSTANT NUMERIC := 9;
  v_p       NUMERIC[] := ARRAY_FILL(0.1::NUMERIC, ARRAY[10]);
  v_total   NUMERIC := 0;
  v_mean    NUMERIC;
  v_target  NUMERIC;
  v_empty   INT := 0;
  v_with    INT;
  v_max     BIGINT;
  v_min     BIGINT;
  v_pc      NUMERIC;
  v_lam     NUMERIC;
  v_meanp   NUMERIC;
  v_cut     BIGINT;
  v_k       INT;
  v_e       NUMERIC;
  v_best_e  NUMERIC := NULL;
  v_best_c  BIGINT;
  v_best_k  INT;
  v_i       INT;
BEGIN
  IF p_coins IS NULL OR array_length(p_coins, 1) <> v_n THEN
    RAISE EXCEPTION 'spin2win_fair_chances: need 10 numbers' USING errcode = '22023';
  END IF;
  IF p_rtp IS NULL OR p_rtp < 20 OR p_rtp > 100 THEN
    RAISE EXCEPTION 'spin2win_fair_chances: RTP must be 20 to 100' USING errcode = '22023';
  END IF;

  v_max := p_coins[1];
  v_min := p_coins[1];
  FOR v_i IN 1..v_n LOOP
    IF p_coins[v_i] < 0 THEN
      RAISE EXCEPTION 'spin2win_fair_chances: negative coins' USING errcode = '22023';
    END IF;
    v_total := v_total + p_coins[v_i];
    IF p_coins[v_i] = 0 THEN v_empty := v_empty + 1; END IF;
    IF p_coins[v_i] > v_max THEN v_max := p_coins[v_i]; END IF;
    IF p_coins[v_i] < v_min THEN v_min := p_coins[v_i]; END IF;
  END LOOP;

  IF v_total = 0 THEN
    RETURN v_p;                                    -- no bets: every number 10%
  END IF;

  v_with   := v_n - v_empty;
  v_mean   := v_rate * v_total / v_n;              -- average payout, random pick
  v_target := v_total * p_rtp / 100;

  IF v_empty > 0 THEN
    IF v_target <= v_mean THEN
      -- Every number with coins: setting / 9. Empty numbers share the rest.
      v_pc := (p_rtp / 100) / v_rate;
      FOR v_i IN 1..v_n LOOP
        v_p[v_i] := CASE WHEN p_coins[v_i] > 0 THEN v_pc
                         ELSE (1 - v_pc * v_with) / v_empty END;
      END LOOP;
    ELSE
      -- Above 90%: lean equally toward every number with coins.
      v_meanp := v_rate * v_total / v_with;
      v_lam := LEAST(1, (v_target - v_mean) / (v_meanp - v_mean));
      FOR v_i IN 1..v_n LOOP
        v_p[v_i] := (1 - v_lam) / v_n
                  + CASE WHEN p_coins[v_i] > 0 THEN v_lam / v_with ELSE 0 END;
      END LOOP;
    END IF;
    RETURN v_p;
  END IF;

  -- Every number has coins.
  IF v_target >= v_mean OR v_max = v_min THEN
    RETURN v_p;                                    -- every number 10%
  END IF;

  -- A2: try each coin level as the cut. Numbers at or below it weigh 2, the
  -- rest 1, so equal coins always weigh the same. Keep the cheapest mix.
  FOR v_cut IN SELECT DISTINCT c FROM unnest(p_coins) AS c WHERE c < v_max ORDER BY c LOOP
    v_k := 0;
    v_e := 0;
    FOR v_i IN 1..v_n LOOP
      IF p_coins[v_i] <= v_cut THEN v_k := v_k + 1; END IF;
    END LOOP;
    FOR v_i IN 1..v_n LOOP
      v_e := v_e + (CASE WHEN p_coins[v_i] <= v_cut THEN 2 ELSE 1 END)::NUMERIC
                 / (v_n + v_k) * v_rate * p_coins[v_i];
    END LOOP;
    IF v_best_e IS NULL OR v_e < v_best_e THEN
      v_best_e := v_e;
      v_best_c := v_cut;
      v_best_k := v_k;
    END IF;
  END LOOP;

  v_lam := LEAST(1, (v_mean - v_target) / (v_mean - v_best_e));
  FOR v_i IN 1..v_n LOOP
    v_p[v_i] := (1 - v_lam) / v_n
              + v_lam * (CASE WHEN p_coins[v_i] <= v_best_c THEN 2 ELSE 1 END)::NUMERIC / (v_n + v_best_k);
  END LOOP;
  RETURN v_p;
END;
$$;

-- 4. Draws one round with Fair draw v2. The same steps and writes as the old
--    draw; only the chances differ.
CREATE FUNCTION public.spin2win_draw_round_v2(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round   public.spin2win_rounds;
  v_s       BIGINT[];
  v_total   BIGINT := 0;
  v_p       NUMERIC[];
  v_roll    NUMERIC;
  v_acc     NUMERIC := 0;
  v_idx     INT := 10;
  v_i       INT;
  v_number  SMALLINT;
BEGIN
  SELECT * INTO v_round FROM public.spin2win_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.winning_number IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true, 'winning_number', v_round.winning_number);
  END IF;

  -- Array index i (1..10) holds number i-1; phone bets and tickets together.
  SELECT ARRAY[
           COALESCE(sum(n0),0), COALESCE(sum(n1),0), COALESCE(sum(n2),0), COALESCE(sum(n3),0), COALESCE(sum(n4),0),
           COALESCE(sum(n5),0), COALESCE(sum(n6),0), COALESCE(sum(n7),0), COALESCE(sum(n8),0), COALESCE(sum(n9),0)
         ]::BIGINT[]
    INTO v_s
    FROM public.spin2win_bets
   WHERE round_id = p_round_id;

  FOR v_i IN 1..10 LOOP
    v_total := v_total + v_s[v_i];
  END LOOP;

  v_p := public.spin2win_fair_chances(v_s, v_round.rtp_percentage);

  -- One secure roll from 0 to just under 1, resolution one in a billion.
  v_roll := public.spin2win_random_int(1000000000)::NUMERIC / 1000000000;
  FOR v_i IN 1..10 LOOP
    v_acc := v_acc + v_p[v_i];
    IF v_roll < v_acc THEN
      v_idx := v_i;
      EXIT;
    END IF;
  END LOOP;

  v_number := (v_idx - 1)::SMALLINT;

  UPDATE public.spin2win_rounds
     SET winning_number = v_number,
         phase = 'drawing', total_stake = v_total, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('winning_number', v_number, 'total_stake', v_total, 'rule', 'v2');
END;
$$;

-- 5. The old draw, unchanged except the switch.
CREATE OR REPLACE FUNCTION public.spin2win_draw_round(p_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_round   public.spin2win_rounds;
  v_s       BIGINT[];
  v_total   BIGINT := 0;
  v_max     BIGINT;
  v_min     BIGINT;
  v_ext     BIGINT;
  v_target  NUMERIC;
  v_mean    NUMERIC;
  v_lambda  NUMERIC := 0;
  v_idx     INT;
  v_n_ext   INT := 0;
  v_k       INT;
  v_i       INT;
  v_number  SMALLINT;
BEGIN
  SELECT * INTO v_round FROM public.spin2win_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.winning_number IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true, 'winning_number', v_round.winning_number);
  END IF;

  -- Fair draw v2 (20261106100000): rounds from spin2win_config.fair_draw_from_round
  -- on are drawn by spin2win_draw_round_v2. NULL (the default) keeps this rule.
  IF EXISTS (SELECT 1 FROM public.spin2win_config
              WHERE id = 'global'
                AND fair_draw_from_round IS NOT NULL
                AND v_round.round_number >= fair_draw_from_round) THEN
    RETURN public.spin2win_draw_round_v2(p_round_id);
  END IF;

  -- Array index i (1..10) holds number i-1.
  SELECT ARRAY[
           COALESCE(sum(n0),0), COALESCE(sum(n1),0), COALESCE(sum(n2),0), COALESCE(sum(n3),0), COALESCE(sum(n4),0),
           COALESCE(sum(n5),0), COALESCE(sum(n6),0), COALESCE(sum(n7),0), COALESCE(sum(n8),0), COALESCE(sum(n9),0)
         ]::BIGINT[]
    INTO v_s
    FROM public.spin2win_bets
   WHERE round_id = p_round_id;

  v_max := v_s[1];
  v_min := v_s[1];
  FOR v_i IN 1..10 LOOP
    v_total := v_total + v_s[v_i];
    IF v_s[v_i] > v_max THEN v_max := v_s[v_i]; END IF;
    IF v_s[v_i] < v_min THEN v_min := v_s[v_i]; END IF;
  END LOOP;

  IF v_total > 0 AND v_max <> v_min THEN
    v_target := v_total * v_round.rtp_percentage / 900.0;   -- rho * T / 9
    v_mean   := v_total / 10.0;
    IF v_target > v_mean THEN
      v_ext := v_max;
    ELSIF v_target < v_mean THEN
      v_ext := v_min;
    END IF;
    IF v_ext IS NOT NULL THEN
      v_lambda := LEAST(1.0, abs(v_target - v_mean) / abs(v_ext - v_mean));
    END IF;
  END IF;

  IF v_lambda > 0 AND public.spin2win_random_int(1000000) < v_lambda * 1000000 THEN
    FOR v_i IN 1..10 LOOP
      IF v_s[v_i] = v_ext THEN v_n_ext := v_n_ext + 1; END IF;
    END LOOP;
    v_k := public.spin2win_random_int(v_n_ext);
    FOR v_i IN 1..10 LOOP
      IF v_s[v_i] = v_ext THEN
        IF v_k = 0 THEN v_idx := v_i; EXIT; END IF;
        v_k := v_k - 1;
      END IF;
    END LOOP;
  ELSE
    v_idx := public.spin2win_random_int(10) + 1;
  END IF;

  v_number := (v_idx - 1)::SMALLINT;

  UPDATE public.spin2win_rounds
     SET winning_number = v_number,
         phase = 'drawing', total_stake = v_total, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('winning_number', v_number, 'total_stake', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.spin2win_fair_chances(BIGINT[], NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spin2win_draw_round_v2(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spin2win_fair_chances(BIGINT[], NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.spin2win_draw_round_v2(UUID) TO service_role;

COMMENT ON FUNCTION public.spin2win_fair_chances(BIGINT[], NUMERIC) IS
  'Fair draw v2: the chance of each Spin2Win number 0 to 9 for one round, from its coins and RTP.';
COMMENT ON FUNCTION public.spin2win_draw_round_v2(UUID) IS
  'Fair draw v2: draws one Spin2Win round. Used by spin2win_draw_round when the switch is on.';

COMMIT;
