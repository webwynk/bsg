-- Migration: 20260726050000_patch_rtp_fallback_and_global_sync.sql
-- Description: Patches RTP fallback default to 96% (96.5% standard) instead of 20%, adds get_system_target_rtp helper, and updates process_bet function.

-- 1. Create get_system_target_rtp helper function
CREATE OR REPLACE FUNCTION public.get_system_target_rtp()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rtp integer;
BEGIN
  SELECT target_win_percentage INTO v_rtp
    FROM public.agent_configs
    LIMIT 1;

  RETURN COALESCE(v_rtp, 96);
END;
$$;

-- 2. Update process_bet to use 96 (96.5% standard) as default fallback instead of 20
CREATE OR REPLACE FUNCTION public.process_bet(
  p_user_id        uuid,
  p_agent_id       uuid,
  p_single_bets    jsonb DEFAULT '{}'::jsonb,
  p_double_bets    jsonb DEFAULT '{}'::jsonb,
  p_triple_bets    jsonb DEFAULT '{}'::jsonb
)
RETURNS public.game_history
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance        numeric;
  v_target_win_pct integer;
  v_red            integer;
  v_green          integer;
  v_black          integer;
  v_total_stake    numeric := 0;
  v_single_win     numeric := 0;
  v_double_win     numeric := 0;
  v_triple_win     numeric := 0;
  v_total_win      numeric := 0;
  v_forced_loss    boolean := false;
  v_history        public.game_history;
  
  v_val            numeric;
  v_win_key        text;
BEGIN
  -- Lock the player row for atomic read-modify-write
  SELECT balance INTO v_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Player not found';
  END IF;

  -- Calculate total stake across all 3 boards
  SELECT COALESCE(SUM(value::numeric), 0) INTO v_val FROM jsonb_each_text(p_single_bets);
  v_total_stake := v_total_stake + v_val;
  SELECT COALESCE(SUM(value::numeric), 0) INTO v_val FROM jsonb_each_text(p_double_bets);
  v_total_stake := v_total_stake + v_val;
  SELECT COALESCE(SUM(value::numeric), 0) INTO v_val FROM jsonb_each_text(p_triple_bets);
  v_total_stake := v_total_stake + v_val;

  IF v_total_stake <= 0 THEN
    RAISE EXCEPTION 'Total bet amount must be greater than zero';
  END IF;

  IF v_balance < v_total_stake THEN
    RAISE EXCEPTION 'Insufficient balance' USING errcode = 'P0001';
  END IF;

  -- Try looking up target win percentage for specific agent, fallback to global system target
  SELECT target_win_percentage INTO v_target_win_pct
    FROM public.agent_configs WHERE agent_id = p_agent_id;

  IF v_target_win_pct IS NULL THEN
    v_target_win_pct := public.get_system_target_rtp();
  END IF;

  -- Roll outcome for 3 concentric rings (Outer Red, Middle Green, Inner Black)
  v_red   := FLOOR(random() * 10)::int;
  v_green := FLOOR(random() * 10)::int;
  v_black := FLOOR(random() * 10)::int;

  -- Force loss if random roll (0-100) exceeds target win percentage (default 96%)
  v_forced_loss := (random() * 100) > COALESCE(v_target_win_pct, 96);

  IF NOT v_forced_loss THEN
    -- 1. Single Board Payout (9x) matching Black digit
    v_win_key := v_black::text;
    IF p_single_bets ? v_win_key THEN
      v_single_win := (p_single_bets->>v_win_key)::numeric * 9;
    END IF;

    -- 2. Double Board Payout (90x) matching Green + Black digits
    v_win_key := LPAD(v_green::text, 1, '0') || LPAD(v_black::text, 1, '0');
    IF p_double_bets ? v_win_key THEN
      v_double_win := (p_double_bets->>v_win_key)::numeric * 90;
    END IF;

    -- 3. Triple Board Payout (900x) matching Red + Green + Black digits
    v_win_key := LPAD(v_red::text, 1, '0') || LPAD(v_green::text, 1, '0') || LPAD(v_black::text, 1, '0');
    IF p_triple_bets ? v_win_key THEN
      v_triple_win := (p_triple_bets->>v_win_key)::numeric * 900;
    END IF;

    v_total_win := v_single_win + v_double_win + v_triple_win;
  END IF;

  -- Debit stake, credit win
  UPDATE public.profiles
    SET balance = balance - v_total_stake + v_total_win
    WHERE id = p_user_id;

  INSERT INTO public.transactions (user_id, agent_id, type, amount, balance_after)
    VALUES (p_user_id, p_agent_id, 'bet_stake', -v_total_stake, v_balance - v_total_stake);

  IF v_total_win > 0 THEN
    INSERT INTO public.transactions (user_id, agent_id, type, amount, balance_after)
      VALUES (p_user_id, p_agent_id, 'bet_payout', v_total_win, (v_balance - v_total_stake) + v_total_win);
  END IF;

  INSERT INTO public.game_history (
    user_id, agent_id, mode, selections, result_number, bet_amount, win_amount, status,
    single_bets, double_bets, triple_bets, red_digit, green_digit, black_digit
  )
  VALUES (
    p_user_id,
    p_agent_id,
    'triple'::public.game_mode,
    CONCAT('R:', v_red, ' G:', v_green, ' B:', v_black),
    (v_red * 100) + (v_green * 10) + v_black,
    v_total_stake,
    v_total_win,
    CASE WHEN v_total_win > 0 THEN 'WON' ELSE 'LOST' END,
    p_single_bets,
    p_double_bets,
    p_triple_bets,
    v_red,
    v_green,
    v_black
  )
  RETURNING * INTO v_history;

  RETURN v_history;
END;
$$;
