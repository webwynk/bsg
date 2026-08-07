-- Issue #4 (MASTER_AUDIT_AND_REMEDIATION_PLAN.md): The bet-cutoff/draw-trigger
-- safety margin has collapsed to zero.
--
-- Verified directly against the live SQL: place_bet()'s only timing guard was
-- `IF v_into >= v_cfg.draw_at_second THEN RAISE EXCEPTION 'ROUND_CLOSED'` --
-- the IDENTICAL value get_current_round()/draw_round() use as the draw
-- trigger. There was no separate bet cutoff; both fired at the same instant.
--
-- get_current_round()'s own comment already claimed otherwise: "draw_at_second
-- is strictly greater than the bet cutoff used by place_bet, so digits cannot
-- exist while a bet is still acceptable." That was false as the code was
-- actually written. 20260807160000_set_draw_at_second_90.sql's own comment
-- independently describes the intended design -- "0..85s: betting, 85s:
-- boards lock, 85..90s: grace/transmission window, 90s: server draw" -- but
-- never actually gave place_bet() the separate 85-second cutoff it describes.
--
-- Fix: add a real, database-enforced bet_cutoff_second (85) that is checked by
-- place_bet() instead of draw_at_second, with a CHECK constraint guaranteeing
-- it always stays strictly before the draw. The draw trigger itself
-- (draw_at_second = 90) is unchanged.

BEGIN;

ALTER TABLE public.game_config
  ADD COLUMN bet_cutoff_second SMALLINT NOT NULL DEFAULT 85
    CHECK (bet_cutoff_second BETWEEN 1 AND 101);

ALTER TABLE public.game_config
  ADD CONSTRAINT game_config_cutoff_before_draw CHECK (bet_cutoff_second < draw_at_second);

UPDATE public.game_config SET bet_cutoff_second = 85 WHERE id = 'global';

CREATE OR REPLACE FUNCTION public.place_bet(p_round_id uuid, p_single_bets jsonb, p_double_bets jsonb, p_triple_bets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user     UUID := auth.uid();
  v_profile  public.profiles;
  v_round    public.rounds;
  v_lim      public.play_limits;
  v_cfg      public.game_config;
  v_cycle    CONSTANT INT := 103;
  v_into     INT := (EXTRACT(EPOCH FROM NOW())::BIGINT % v_cycle)::INT;
  v_k        TEXT;
  v_v        BIGINT;
  v_stake    BIGINT := 0;
  v_prev     BIGINT := 0;
  v_delta    BIGINT;
  v_balance  BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;
  IF v_profile.role <> 'player' THEN
    RAISE EXCEPTION 'Only players may place bets' USING errcode = 'P0114';
  END IF;

  SELECT * INTO v_cfg FROM public.game_config WHERE id = 'global';
  SELECT * INTO v_lim FROM public.play_limits WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
  END IF;

  -- Three independent guards.
  --
  -- The second guard now checks bet_cutoff_second (85), a real, earlier,
  -- database-enforced cutoff -- not draw_at_second (90), which is the draw
  -- trigger itself. Was: IF v_into >= v_cfg.draw_at_second (zero margin from
  -- the draw). See 20260808000600_restore_bet_cutoff_margin.sql.
  IF v_round.red IS NOT NULL THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_into >= v_cfg.bet_cutoff_second THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_round.round_number <> (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;

  -- ── validate + total, one board at a time ────────────────────────────────
  FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(COALESCE(p_single_bets,'{}')) LOOP
    IF v_k !~ '^[0-9]$' THEN RAISE EXCEPTION 'BAD_SINGLE_KEY:%', v_k USING errcode='P0122'; END IF;
    IF v_v < v_lim.single_min THEN RAISE EXCEPTION 'BELOW_MIN' USING errcode='P0123'; END IF;
    IF v_v > v_lim.single_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode='P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(COALESCE(p_double_bets,'{}')) LOOP
    IF v_k !~ '^[0-9]{2}$' THEN RAISE EXCEPTION 'BAD_DOUBLE_KEY:%', v_k USING errcode='P0122'; END IF;
    IF v_v < v_lim.double_min THEN RAISE EXCEPTION 'BELOW_MIN' USING errcode='P0123'; END IF;
    IF v_v > v_lim.double_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode='P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(COALESCE(p_triple_bets,'{}')) LOOP
    IF v_k !~ '^[0-9]{3}$' THEN RAISE EXCEPTION 'BAD_TRIPLE_KEY:%', v_k USING errcode='P0122'; END IF;
    IF v_v < v_lim.triple_min THEN RAISE EXCEPTION 'BELOW_MIN' USING errcode='P0123'; END IF;
    IF v_v > v_lim.triple_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode='P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  IF v_stake <= 0 THEN
    RAISE EXCEPTION 'EMPTY_BET' USING errcode = 'P0125';
  END IF;

  -- Replacing an existing bet charges only the difference.
  SELECT total_stake INTO v_prev FROM public.bets
    WHERE round_id = p_round_id AND user_id = v_user FOR UPDATE;
  v_prev  := COALESCE(v_prev, 0);
  v_delta := v_stake - v_prev;

  IF v_delta <> 0 THEN
    -- A reduced bet is a stake_refund, never a 'payout' -- booking it as a
    -- payout would inflate every win statistic in the dashboard.
    v_balance := public.apply_coin_movement(
      v_user, NULL, CASE WHEN v_delta > 0 THEN 'stake' ELSE 'stake_refund' END,
      -v_delta, p_round_id);
  ELSE
    v_balance := v_profile.coin_balance;
  END IF;

  INSERT INTO public.bets (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
  VALUES (p_round_id, v_user,
          COALESCE(p_single_bets,'{}'), COALESCE(p_double_bets,'{}'),
          COALESCE(p_triple_bets,'{}'), v_stake)
  ON CONFLICT (round_id, user_id) DO UPDATE
    SET single_bets = EXCLUDED.single_bets,
        double_bets = EXCLUDED.double_bets,
        triple_bets = EXCLUDED.triple_bets,
        total_stake = EXCLUDED.total_stake,
        is_settled  = false,
        single_payout = 0, double_payout = 0, triple_payout = 0, total_payout = 0;

  RETURN jsonb_build_object(
    'success',        true,
    'total_stake',    v_stake,
    'coin_balance',   v_balance,
    'ledger_version', (SELECT ledger_version FROM public.profiles WHERE id = v_user)
  );
END;
$function$
;

COMMENT ON FUNCTION public.get_current_round() IS
  'The clock. bet_cutoff_second (game_config) is strictly before draw_at_second, '
  'enforced by game_config_cutoff_before_draw, so digits cannot exist while a '
  'bet is still acceptable.';

COMMIT;
