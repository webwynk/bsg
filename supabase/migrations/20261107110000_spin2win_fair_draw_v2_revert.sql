-- Reverts 20261106100000_spin2win_fair_draw_v2.sql: Spin2Win goes back to the draw it had before 2026-11-06.
--
-- What this puts back, exactly as it was before the install:
--   * public.spin2win_draw_round(uuid): the old body (the pre-install live definition,
--     identical to scripts/spin2win_fair_draw_v2_rollback.sql). CREATE OR REPLACE keeps its grants
--     (postgres + service_role only).
--   * the RTP rule 30 to 100 on spin2win_config and spin2win_rounds.
-- What this removes: spin2win_draw_round_v2(uuid), spin2win_fair_chances(...), and the
-- switch column spin2win_config.fair_draw_from_round.
--
-- One data step the plain rollback script does not have: rounds opened below 30%
-- during the 2026-11-06 tests would block the old 30-to-100 rule, so their setting
-- label is raised to 30 here, with one audit_log line listing them. No Spin2Win round was below 30% on 2026-11-07, so the relabel step is expected to do nothing.
-- The block stops (nothing changes) if any round below 30% has bets, ledger rows
-- or tickets, or if the live Spin2Win setting itself is below 30.
--
-- Not touched: the other games, spin2win_settle_round, spin2win_place_bet, tickets,
-- spin2win_tick_rounds, bonus. Apply in the quiet gap right after a Spin2Win draw.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $chk$
DECLARE
  v_low UUID[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.spin2win_config WHERE rtp_percentage < 30) THEN
    RAISE EXCEPTION 'The Spin2Win setting is below 30%%; raise it before reverting';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY round_number), '{}') INTO v_low
    FROM public.spin2win_rounds WHERE rtp_percentage < 30;

  IF EXISTS (SELECT 1 FROM public.spin2win_bets WHERE round_id = ANY (v_low))
     OR EXISTS (SELECT 1 FROM public.coin_ledger WHERE spin2win_round_id = ANY (v_low))
     OR EXISTS (SELECT 1 FROM public.print_tickets WHERE spin2win_round_id = ANY (v_low)) THEN
    RAISE EXCEPTION 'A Spin2Win round below 30%% has bets, ledger rows or tickets; not reverting';
  END IF;

  IF cardinality(v_low) > 0 THEN
    INSERT INTO public.audit_log (kind, detail)
    SELECT 'system',
           'Spin2Win revert to the old draw: setting label of ' || count(*)
           || ' empty test round(s) raised to 30% (was '
           || string_agg('SW-' || round_number || ' ' || rtp_percentage::INT || '%', ', ' ORDER BY round_number)
           || ') so the old 30-100 rule can return'
      FROM public.spin2win_rounds WHERE id = ANY (v_low);

    UPDATE public.spin2win_rounds SET rtp_percentage = 30 WHERE id = ANY (v_low);
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
