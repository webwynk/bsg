-- Restores spin2win_place_bet exactly as it was live on 2026-10-31, before the print guard.
BEGIN;

CREATE OR REPLACE FUNCTION public.spin2win_place_bet(p_round_id uuid, p_bets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user     UUID := auth.uid();
  v_profile  public.profiles;
  v_round    public.spin2win_rounds;
  v_cutoff   INT;
  v_cycle    CONSTANT INT := 100;
  v_into     INT := (EXTRACT(EPOCH FROM NOW())::BIGINT % v_cycle)::INT;
  v_bets     JSONB := COALESCE(p_bets, '{}'::jsonb);
  v_k        TEXT;
  v_val      JSONB;
  v_v        BIGINT;
  v_stake    BIGINT := 0;
  v_prev     BIGINT := 0;
  v_delta    BIGINT;
  v_balance  BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  -- Early account check, unlocked: before any round lock so the lock order
  -- stays round -> profile.
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;
  IF v_profile.role <> 'player' THEN
    RAISE EXCEPTION 'Only players may place bets' USING errcode = 'P0114';
  END IF;

  SELECT bet_cutoff_second INTO v_cutoff FROM public.spin2win_config WHERE id = 'global';

  -- FOR SHARE: bets run in parallel; draw and settle take FOR UPDATE and wait.
  SELECT * INTO v_round FROM public.spin2win_rounds WHERE id = p_round_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
  END IF;

  -- Three independent closed-round guards.
  IF v_round.winning_number IS NOT NULL THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_into >= v_cutoff THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_round.round_number <> (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;

  -- Validate every number and total the stake. Limits are fixed: 5 to 10,000.
  IF jsonb_typeof(v_bets) <> 'object' THEN
    RAISE EXCEPTION 'BAD_BET:not an object' USING errcode = 'P0126';
  END IF;
  FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_bets) LOOP
    IF v_k NOT IN ('n0','n1','n2','n3','n4','n5','n6','n7','n8','n9') THEN
      RAISE EXCEPTION 'BAD_BET:%', v_k USING errcode = 'P0126';
    END IF;
    IF jsonb_typeof(v_val) <> 'number' OR v_val::text !~ '^-?[0-9]{1,15}$' THEN
      RAISE EXCEPTION 'BAD_BET:%', v_k USING errcode = 'P0126';
    END IF;
    v_v := v_val::text::BIGINT;
    CONTINUE WHEN v_v = 0;
    IF v_v < 5     THEN RAISE EXCEPTION 'BELOW_MIN'   USING errcode = 'P0123'; END IF;
    IF v_v > 10000 THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode = 'P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  IF v_stake <= 0 THEN
    RAISE EXCEPTION 'EMPTY_BET' USING errcode = 'P0125';
  END IF;

  -- Serialise this player's own requests, and re-check the account locked.
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;

  -- Replacing an existing bet charges only the difference.
  SELECT total_stake INTO v_prev FROM public.spin2win_bets
    WHERE round_id = p_round_id AND user_id = v_user FOR UPDATE;
  v_prev  := COALESCE(v_prev, 0);
  v_delta := v_stake - v_prev;

  IF v_delta <> 0 THEN
    -- A reduced bet is a stake_refund, never a 'payout'.
    v_balance := public.spin2win_apply_coin_movement(
      v_user, NULL, CASE WHEN v_delta > 0 THEN 'stake' ELSE 'stake_refund' END,
      -v_delta, p_round_id);
  ELSE
    v_balance := v_profile.coin_balance;
  END IF;

  INSERT INTO public.spin2win_bets
    (round_id, user_id, n0, n1, n2, n3, n4, n5, n6, n7, n8, n9, total_stake)
  VALUES
    (p_round_id, v_user,
     COALESCE((v_bets->>'n0')::BIGINT, 0), COALESCE((v_bets->>'n1')::BIGINT, 0),
     COALESCE((v_bets->>'n2')::BIGINT, 0), COALESCE((v_bets->>'n3')::BIGINT, 0),
     COALESCE((v_bets->>'n4')::BIGINT, 0), COALESCE((v_bets->>'n5')::BIGINT, 0),
     COALESCE((v_bets->>'n6')::BIGINT, 0), COALESCE((v_bets->>'n7')::BIGINT, 0),
     COALESCE((v_bets->>'n8')::BIGINT, 0), COALESCE((v_bets->>'n9')::BIGINT, 0),
     v_stake)
  ON CONFLICT (round_id, user_id) DO UPDATE
    SET n0 = EXCLUDED.n0, n1 = EXCLUDED.n1, n2 = EXCLUDED.n2, n3 = EXCLUDED.n3, n4 = EXCLUDED.n4,
        n5 = EXCLUDED.n5, n6 = EXCLUDED.n6, n7 = EXCLUDED.n7, n8 = EXCLUDED.n8, n9 = EXCLUDED.n9,
        total_stake = EXCLUDED.total_stake,
        is_settled = false, total_payout = 0, settled_at = NULL;

  RETURN jsonb_build_object(
    'success',        true,
    'total_stake',    v_stake,
    'coin_balance',   v_balance,
    'ledger_version', (SELECT ledger_version FROM public.profiles WHERE id = v_user)
  );
END;
$function$;

COMMIT;
