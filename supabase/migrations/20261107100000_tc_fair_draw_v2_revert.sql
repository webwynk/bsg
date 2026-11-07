-- Reverts 20261106110000_tc_fair_draw_v2.sql: Triple Chance goes back to the
-- draw it had before 2026-11-06 ("closest to target").
--
-- What this puts back, exactly as it was before the install:
--   * public.draw_round(uuid): the old body (the pre-install live definition,
--     identical to scripts/tc_fair_draw_v2_rollback.sql). CREATE OR REPLACE
--     keeps its grants (postgres + service_role only).
--   * the RTP rule 50 to 100 on game_config and rounds.
-- What this removes: draw_round_v2(uuid), tc_fair_chances(...), and the switch
-- column game_config.fair_draw_from_round.
--
-- One data step the plain rollback script does not have: 10 empty test rounds
-- (TC-17417223 to 17417233, no bets, no ledger rows, no tickets) were opened
-- at 20/30/40% during the 2026-11-06 ten-player test. The old 50-to-100 rule
-- can't be put back while they exist, so their setting label is raised to 50
-- here, with one audit_log line listing them. The block stops (nothing changes)
-- if any round below 50% has bets, ledger rows or tickets, or if the live
-- Triple Chance setting itself is below 50.
--
-- Not touched: Spin2Win, Lucky Card and Lucky 16 (their own draw functions,
-- configs and switches), settle_round, place_bet, tickets, tick_rounds, bonus.
-- Apply in the quiet gap right after a Triple Chance draw.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $chk$
DECLARE
  v_low UUID[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_config WHERE rtp_percentage < 50) THEN
    RAISE EXCEPTION 'The Triple Chance setting is below 50%%; raise it before reverting';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY round_number), '{}') INTO v_low
    FROM public.rounds WHERE rtp_percentage < 50;

  IF EXISTS (SELECT 1 FROM public.bets WHERE round_id = ANY (v_low))
     OR EXISTS (SELECT 1 FROM public.coin_ledger WHERE round_id = ANY (v_low))
     OR EXISTS (SELECT 1 FROM public.print_tickets WHERE round_id = ANY (v_low)) THEN
    RAISE EXCEPTION 'A Triple Chance round below 50%% has bets, ledger rows or tickets; not reverting';
  END IF;

  IF cardinality(v_low) > 0 THEN
    INSERT INTO public.audit_log (kind, detail)
    SELECT 'system',
           'Triple Chance revert to the old draw: setting label of ' || count(*)
           || ' empty test round(s) raised to 50% (was '
           || string_agg('TC-' || round_number || ' ' || rtp_percentage::INT || '%', ', ' ORDER BY round_number)
           || ') so the old 50-100 rule can return'
      FROM public.rounds WHERE id = ANY (v_low);

    UPDATE public.rounds SET rtp_percentage = 50 WHERE id = ANY (v_low);
  END IF;
END;
$chk$;

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

DROP FUNCTION public.draw_round_v2(UUID);
DROP FUNCTION public.tc_fair_chances(BIGINT[], BIGINT[], BIGINT[], NUMERIC);

ALTER TABLE public.game_config DROP COLUMN fair_draw_from_round;

ALTER TABLE public.game_config DROP CONSTRAINT game_config_rtp_percentage_check;
ALTER TABLE public.game_config ADD CONSTRAINT game_config_rtp_percentage_check
  CHECK (rtp_percentage >= 50 AND rtp_percentage <= 100);
ALTER TABLE public.rounds DROP CONSTRAINT rounds_rtp_percentage_check;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_rtp_percentage_check
  CHECK (rtp_percentage >= 50 AND rtp_percentage <= 100);

COMMIT;
