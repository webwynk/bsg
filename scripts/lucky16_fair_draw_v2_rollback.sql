-- Undoes 20261106130000_lucky16_fair_draw_v2.sql.
--
-- Puts back the old Lucky 16 draw exactly as it was before (copied from the
-- live database on 2026-11-06), removes the new functions and the switch, and
-- restores RTP 30 to 100. Stops without changing anything if a setting or a
-- round below 30% exists, because the old rule would reject it.
-- Apply between rounds.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lucky16_config WHERE rtp_percentage < 30)
     OR EXISTS (SELECT 1 FROM public.lucky16_rounds WHERE rtp_percentage < 30) THEN
    RAISE EXCEPTION 'A Lucky 16 setting or round is below 30%%; raise it before rolling back';
  END IF;
END;
$chk$;

CREATE OR REPLACE FUNCTION public.lucky16_draw_round(p_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round   public.lucky16_rounds;
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
  v_ranks   CONSTANT TEXT[] := ARRAY['A','J','Q','K'];
  v_suits   CONSTANT TEXT[] := ARRAY['hearts','spades','diamonds','clubs'];
  v_rank    TEXT;
  v_suit    TEXT;
BEGIN
  SELECT * INTO v_round FROM public.lucky16_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.winning_rank IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true,
      'winning_rank', v_round.winning_rank, 'winning_suit', v_round.winning_suit);
  END IF;

  -- Pool every player's stake per card, in the card order above.
  SELECT ARRAY[
           COALESCE(sum(a_hearts),0), COALESCE(sum(a_spades),0), COALESCE(sum(a_diamonds),0), COALESCE(sum(a_clubs),0),
           COALESCE(sum(j_hearts),0), COALESCE(sum(j_spades),0), COALESCE(sum(j_diamonds),0), COALESCE(sum(j_clubs),0),
           COALESCE(sum(q_hearts),0), COALESCE(sum(q_spades),0), COALESCE(sum(q_diamonds),0), COALESCE(sum(q_clubs),0),
           COALESCE(sum(k_hearts),0), COALESCE(sum(k_spades),0), COALESCE(sum(k_diamonds),0), COALESCE(sum(k_clubs),0)
         ]::BIGINT[]
    INTO v_s
    FROM public.lucky16_bets
   WHERE round_id = p_round_id;

  v_max := v_s[1];
  v_min := v_s[1];
  FOR v_i IN 1..16 LOOP
    v_total := v_total + v_s[v_i];
    IF v_s[v_i] > v_max THEN v_max := v_s[v_i]; END IF;
    IF v_s[v_i] < v_min THEN v_min := v_s[v_i]; END IF;
  END LOOP;

  IF v_total > 0 AND v_max <> v_min THEN
    v_target := v_total * v_round.rtp_percentage / 1400.0;   -- rho * T / 14
    v_mean   := v_total / 16.0;
    IF v_target > v_mean THEN
      v_ext := v_max;
    ELSIF v_target < v_mean THEN
      v_ext := v_min;
    END IF;
    IF v_ext IS NOT NULL THEN
      v_lambda := LEAST(1.0, abs(v_target - v_mean) / abs(v_ext - v_mean));
    END IF;
  END IF;

  -- One random draw decides whether this round is tilted; resolution 1e-6.
  IF v_lambda > 0 AND public.lucky16_random_int(1000000) < v_lambda * 1000000 THEN
    FOR v_i IN 1..16 LOOP
      IF v_s[v_i] = v_ext THEN v_n_ext := v_n_ext + 1; END IF;
    END LOOP;
    v_k := public.lucky16_random_int(v_n_ext);
    FOR v_i IN 1..16 LOOP
      IF v_s[v_i] = v_ext THEN
        IF v_k = 0 THEN v_idx := v_i; EXIT; END IF;
        v_k := v_k - 1;
      END IF;
    END LOOP;
  ELSE
    v_idx := public.lucky16_random_int(16) + 1;
  END IF;

  v_rank := v_ranks[(v_idx - 1) / 4 + 1];
  v_suit := v_suits[(v_idx - 1) % 4 + 1];

  UPDATE public.lucky16_rounds
     SET winning_rank = v_rank, winning_suit = v_suit,
         phase = 'drawing', total_stake = v_total, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('winning_rank', v_rank, 'winning_suit', v_suit,
                            'total_stake', v_total);
END;
$function$;

DROP FUNCTION public.lucky16_draw_round_v2(UUID);
DROP FUNCTION public.lucky16_fair_chances(BIGINT[], NUMERIC);

ALTER TABLE public.lucky16_config DROP COLUMN fair_draw_from_round;

ALTER TABLE public.lucky16_config DROP CONSTRAINT lucky16_config_rtp_percentage_check;
ALTER TABLE public.lucky16_config ADD CONSTRAINT lucky16_config_rtp_percentage_check
  CHECK (rtp_percentage >= 30 AND rtp_percentage <= 100);
ALTER TABLE public.lucky16_rounds DROP CONSTRAINT lucky16_rounds_rtp_percentage_check;
ALTER TABLE public.lucky16_rounds ADD CONSTRAINT lucky16_rounds_rtp_percentage_check
  CHECK (rtp_percentage >= 30 AND rtp_percentage <= 100);

COMMIT;
