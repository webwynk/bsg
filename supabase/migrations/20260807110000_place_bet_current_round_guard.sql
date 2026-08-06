-- Fix: place_bet accepted bets for rounds that had already finished.
--
-- Its two guards were "round exists" and "red IS NOT NULL". Neither catches a
-- round that ENDED but was never drawn — such a round keeps red = NULL and
-- phase = 'betting' forever, so it stayed a valid bet target indefinitely.
--
-- Combined with a client caching a stale round id, that debited real stakes
-- into rounds which could never settle. Live evidence: a bet created at
-- 21:26:48 was booked against round 17340305, which had ended at 21:25:18.
--
-- The third guard makes the round id legal only if it IS the round the server
-- clock says is current, so the server is correct regardless of the client.
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
  -- The third was added after live testing exposed the gap the first two
  -- leave open. A round that has ENDED but was never drawn still has
  -- red IS NULL and phase 'betting', so guards 1 and 2 both pass and the bet
  -- is accepted into a dead round: the stake is debited and nothing ever
  -- settles it. That is what stranded real coins in testing — a client
  -- holding a stale round id bet one round behind for the entire session.
  --
  -- The round id is only a legal bet target if it IS the round the clock says
  -- is current. This makes the server correct no matter what the client sends.
  IF v_round.red IS NOT NULL THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_into >= v_cfg.draw_at_second THEN
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
    -- A reduced bet is a stake_refund, never a 'payout' — booking it as a
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
