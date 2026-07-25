-- Migration: 20260725220000_update_multi_board_betting_and_history.sql
-- Description: Updates game_history table and process_bet function to support 3-ring outcomes and multi-board bets (Single 9x, Double 90x, Triple 900x).

-- 1. Alter game_history to support 3-ring outcome digits and multi-board bet JSONB maps
ALTER TABLE public.game_history
  ADD COLUMN IF NOT EXISTS single_bets jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS double_bets jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS triple_bets jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS red_digit integer CHECK (red_digit BETWEEN 0 AND 9),
  ADD COLUMN IF NOT EXISTS green_digit integer CHECK (green_digit BETWEEN 0 AND 9),
  ADD COLUMN IF NOT EXISTS black_digit integer CHECK (black_digit BETWEEN 0 AND 9);

-- 2. Update process_bet to handle multi-board simultaneous bets & 3-ring wheel outcomes
CREATE OR REPLACE FUNCTION public.process_bet(
  p_user_id        uuid,
  p_agent_id       uuid,
  p_single_bets    jsonb DEFAULT '{}'::jsonb,  -- e.g. { "7": 10 }
  p_double_bets    jsonb DEFAULT '{}'::jsonb,  -- e.g. { "42": 50 }
  p_triple_bets    jsonb DEFAULT '{}'::jsonb   -- e.g. { "342": 100 }
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

  SELECT target_win_percentage INTO v_target_win_pct
    FROM public.agent_configs WHERE agent_id = p_agent_id;

  -- Roll outcome for 3 concentric rings (Outer Red, Middle Green, Inner Black)
  v_red   := FLOOR(random() * 10)::int;
  v_green := FLOOR(random() * 10)::int;
  v_black := FLOOR(random() * 10)::int;

  v_forced_loss := (random() * 100) > COALESCE(v_target_win_pct, 20);

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
      VALUES (p_user_id, p_agent_id, 'bet_payout', v_total_win, v_balance - v_total_stake + v_total_win);
  END IF;

  INSERT INTO public.game_history (
    user_id, agent_id, mode, bet_amount, single_bets, double_bets, triple_bets,
    red_digit, green_digit, black_digit, win_amount, is_forced_loss
  ) VALUES (
    p_user_id, p_agent_id, 'triple', v_total_stake, p_single_bets, p_double_bets, p_triple_bets,
    COALESCE(v_red, 0), COALESCE(v_green, 0), COALESCE(v_black, 0), v_total_win, v_forced_loss
  ) RETURNING * INTO v_history;

  RETURN v_history;
END;
$$;
