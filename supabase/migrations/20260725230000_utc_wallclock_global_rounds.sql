-- Migration: 20260725230000_utc_wallclock_global_rounds.sql
-- Description: 24/7 UTC Wall-Clock Global Round Generator & Recent Rounds API for History Grid

-- 1. UTC Wall-Clock Driven get_current_round() RPC
CREATE OR REPLACE FUNCTION public.get_current_round()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_epoch int := extract(epoch from now())::int;
  v_round_num bigint := floor(v_now_epoch / 73)::bigint;
  v_secs_remaining int := 73 - (v_now_epoch % 73);
  v_round public.game_rounds;
  v_red int;
  v_green int;
  v_black int;
  v_hash text;
  v_status text;
BEGIN
  -- Determine current round status (60s betting, 13s spinning/revealing)
  v_status := CASE 
    WHEN v_secs_remaining >= 14 THEN 'betting' 
    WHEN v_secs_remaining > 0 THEN 'spinning' 
    ELSE 'complete' 
  END;

  -- Check if round row already exists
  SELECT * INTO v_round FROM public.game_rounds WHERE round_number = v_round_num;

  IF v_round IS NULL THEN
    -- Generate deterministic outcome digits for this round_number (0-9 for red, green, black)
    v_hash := md5('bsg_seed_' || v_round_num::text);
    v_red   := (abs(('x' || substr(v_hash, 1, 8))::bit(32)::int) % 10);
    v_green := (abs(('x' || substr(v_hash, 9, 8))::bit(32)::int) % 10);
    v_black := (abs(('x' || substr(v_hash, 17, 8))::bit(32)::int) % 10);

    INSERT INTO public.game_rounds (
      round_number,
      scheduled_at,
      status,
      red,
      green,
      black
    ) VALUES (
      v_round_num,
      to_timestamp((v_round_num + 1) * 73),
      v_status,
      v_red,
      v_green,
      v_black
    ) RETURNING * INTO v_round;
  END IF;

  RETURN jsonb_build_object(
    'round_id', v_round.id,
    'round_number', v_round.round_number,
    'status', v_status,
    'scheduled_at', v_round.scheduled_at,
    'seconds_remaining', v_secs_remaining,
    'red', v_round.red,
    'green', v_round.green,
    'black', v_round.black
  );
END;
$$;

-- 2. get_recent_rounds() RPC for History Grid Initialization
CREATE OR REPLACE FUNCTION public.get_recent_rounds(p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb;
BEGIN
  SELECT jsonb_agg(r ORDER BY r.round_number DESC) INTO v_results
  FROM (
    SELECT id, round_number, red, green, black, scheduled_at, created_at
    FROM public.game_rounds
    WHERE red IS NOT NULL AND green IS NOT NULL AND black IS NOT NULL
    ORDER BY round_number DESC
    LIMIT p_limit
  ) r;

  RETURN COALESCE(v_results, '[]'::jsonb);
END;
$$;
