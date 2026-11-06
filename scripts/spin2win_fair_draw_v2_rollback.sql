-- Undoes 20261106100000_spin2win_fair_draw_v2.sql.
--
-- Puts back the old draw exactly as it was before, removes the new functions and
-- the switch, and restores RTP 30 to 100. Stops without changing anything if a
-- setting or a round below 30% exists, because the old rule would reject it.
-- Apply between rounds.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.spin2win_config WHERE rtp_percentage < 30)
     OR EXISTS (SELECT 1 FROM public.spin2win_rounds WHERE rtp_percentage < 30) THEN
    RAISE EXCEPTION 'A Spin2Win setting or round is below 30%%; raise it before rolling back';
  END IF;
END;
$chk$;

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

DROP FUNCTION public.spin2win_draw_round_v2(UUID);
DROP FUNCTION public.spin2win_fair_chances(BIGINT[], NUMERIC);

ALTER TABLE public.spin2win_config DROP COLUMN fair_draw_from_round;

ALTER TABLE public.spin2win_config DROP CONSTRAINT spin2win_config_rtp_percentage_check;
ALTER TABLE public.spin2win_config ADD CONSTRAINT spin2win_config_rtp_percentage_check
  CHECK (rtp_percentage >= 30 AND rtp_percentage <= 100);
ALTER TABLE public.spin2win_rounds DROP CONSTRAINT spin2win_rounds_rtp_percentage_check;
ALTER TABLE public.spin2win_rounds ADD CONSTRAINT spin2win_rounds_rtp_percentage_check
  CHECK (rtp_percentage >= 30 AND rtp_percentage <= 100);

COMMIT;
