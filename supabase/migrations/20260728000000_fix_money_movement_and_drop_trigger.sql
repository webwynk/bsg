-- Migration: 20260728000000_fix_money_movement_and_drop_trigger.sql
-- Description: 
-- 1. Drops trg_sync_user_metadata_balance trigger to prevent Auth metadata overwriting public.profiles.balance.
-- 2. Implements atomic Security Definer RPC functions for money movement (issue_agent_coins, transfer_coins_agent_to_player, withdraw_coins_player_to_agent).
-- 3. Fixes submit_round_bet multi-deduction bug on bet updates and adds transaction ledger logging.
-- 4. Patches resolve_round to add transaction ledger logging for win payouts.

-- ============================================================================
-- 1. DROP THE BALANCE OVERWRITE TRIGGER & FUNCTION
-- ============================================================================
DROP TRIGGER IF EXISTS trg_sync_user_metadata_balance ON auth.users;
DROP FUNCTION IF EXISTS public.sync_user_metadata_balance_to_profiles();

-- ============================================================================
-- 2. CASHIER & MONEY MOVEMENT SECURITY DEFINER RPCS
-- ============================================================================

-- A. issue_agent_coins (Superadmin -> Agent)
CREATE OR REPLACE FUNCTION public.issue_agent_coins(
  p_admin_id  uuid,
  p_agent_id  uuid,
  p_amount    numeric,
  p_type      text DEFAULT 'deposit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_username TEXT;
  v_admin_username TEXT;
  v_new_balance    NUMERIC;
  v_sanitized_amt  NUMERIC := ROUND(p_amount, 2);
BEGIN
  IF v_sanitized_amt <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING errcode = 'P0001';
  END IF;

  -- Lock agent row for atomic update
  SELECT username, balance INTO v_agent_username, v_new_balance
    FROM public.profiles
    WHERE id = p_agent_id AND role = 'agent'
    FOR UPDATE;

  IF v_agent_username IS NULL THEN
    RAISE EXCEPTION 'Agent profile not found' USING errcode = 'P0002';
  END IF;

  IF p_type = 'withdraw' THEN
    IF v_new_balance < v_sanitized_amt THEN
      RAISE EXCEPTION 'Insufficient agent balance' USING errcode = 'P0003';
    END IF;
    v_new_balance := v_new_balance - v_sanitized_amt;
  ELSE
    v_new_balance := v_new_balance + v_sanitized_amt;
  END IF;

  UPDATE public.profiles
    SET balance = v_new_balance, updated_at = NOW()
    WHERE id = p_agent_id;

  INSERT INTO public.agent_coin_transactions (agent_id, agent_name, agent_username, admin_id, type, amount)
    VALUES (p_agent_id, v_agent_username, v_agent_username, p_admin_id, p_type, v_sanitized_amt);

  RETURN jsonb_build_object(
    'success', true,
    'agent_id', p_agent_id,
    'new_balance', v_new_balance
  );
END;
$$;


-- B. transfer_coins_agent_to_player (Agent -> Player Deposit)
CREATE OR REPLACE FUNCTION public.transfer_coins_agent_to_player(
  p_agent_id  uuid,
  p_player_id uuid,
  p_amount    numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_bal       NUMERIC;
  v_agent_uname     TEXT;
  v_player_bal      NUMERIC;
  v_player_uname    TEXT;
  v_player_agent_id UUID;
  v_sanitized_amt   NUMERIC := ROUND(p_amount, 2);
BEGIN
  IF v_sanitized_amt <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING errcode = 'P0001';
  END IF;

  -- Lock agent profile
  SELECT username, balance INTO v_agent_uname, v_agent_bal
    FROM public.profiles
    WHERE id = p_agent_id
    FOR UPDATE;

  IF v_agent_uname IS NULL THEN
    RAISE EXCEPTION 'Agent profile not found' USING errcode = 'P0002';
  END IF;

  IF v_agent_bal < v_sanitized_amt THEN
    RAISE EXCEPTION 'Insufficient agent coins balance. Available: %, Requested: %', v_agent_bal, v_sanitized_amt USING errcode = 'P0003';
  END IF;

  -- Lock player profile
  SELECT username, balance, agent_id INTO v_player_uname, v_player_bal, v_player_agent_id
    FROM public.profiles
    WHERE id = p_player_id
    FOR UPDATE;

  IF v_player_uname IS NULL THEN
    RAISE EXCEPTION 'Player profile not found' USING errcode = 'P0004';
  END IF;

  -- Security Scoping Check: Player must belong to this Agent (or unassigned, in which case assign now)
  IF v_player_agent_id IS NOT NULL AND v_player_agent_id != p_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: Player belongs to a different agent' USING errcode = 'P0005';
  END IF;

  -- Execute Atomic Balance Transfers
  UPDATE public.profiles
    SET balance = balance - v_sanitized_amt, updated_at = NOW()
    WHERE id = p_agent_id;

  UPDATE public.profiles
    SET balance = balance + v_sanitized_amt,
        agent_id = p_agent_id,
        updated_at = NOW()
    WHERE id = p_player_id;

  -- Insert Transaction Record into Ledger
  INSERT INTO public.transactions (user_id, agent_id, agent_username, user_name, user_username, type, amount, balance_after)
    VALUES (p_player_id, p_agent_id, v_agent_uname, v_player_uname, v_player_uname, 'agent_credit', v_sanitized_amt, v_player_bal + v_sanitized_amt);

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id,
    'new_player_balance', v_player_bal + v_sanitized_amt,
    'new_agent_balance', v_agent_bal - v_sanitized_amt
  );
END;
$$;


-- C. withdraw_coins_player_to_agent (Agent <- Player Withdrawal)
CREATE OR REPLACE FUNCTION public.withdraw_coins_player_to_agent(
  p_agent_id  uuid,
  p_player_id uuid,
  p_amount    numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_bal       NUMERIC;
  v_agent_uname     TEXT;
  v_player_bal      NUMERIC;
  v_player_uname    TEXT;
  v_player_agent_id UUID;
  v_sanitized_amt   NUMERIC := ROUND(p_amount, 2);
BEGIN
  IF v_sanitized_amt <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING errcode = 'P0001';
  END IF;

  -- Lock player profile
  SELECT username, balance, agent_id INTO v_player_uname, v_player_bal, v_player_agent_id
    FROM public.profiles
    WHERE id = p_player_id
    FOR UPDATE;

  IF v_player_uname IS NULL THEN
    RAISE EXCEPTION 'Player profile not found' USING errcode = 'P0004';
  END IF;

  -- Security Scoping Check
  IF v_player_agent_id IS NOT NULL AND v_player_agent_id != p_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: Player belongs to a different agent' USING errcode = 'P0005';
  END IF;

  IF v_player_bal < v_sanitized_amt THEN
    RAISE EXCEPTION 'Insufficient player coins balance. Available: %, Requested: %', v_player_bal, v_sanitized_amt USING errcode = 'P0003';
  END IF;

  -- Lock agent profile
  SELECT username, balance INTO v_agent_uname, v_agent_bal
    FROM public.profiles
    WHERE id = p_agent_id
    FOR UPDATE;

  IF v_agent_uname IS NULL THEN
    RAISE EXCEPTION 'Agent profile not found' USING errcode = 'P0002';
  END IF;

  -- Execute Atomic Balance Transfers
  UPDATE public.profiles
    SET balance = balance - v_sanitized_amt, updated_at = NOW()
    WHERE id = p_player_id;

  UPDATE public.profiles
    SET balance = balance + v_sanitized_amt, updated_at = NOW()
    WHERE id = p_agent_id;

  -- Insert Transaction Record into Ledger
  INSERT INTO public.transactions (user_id, agent_id, agent_username, user_name, user_username, type, amount, balance_after)
    VALUES (p_player_id, p_agent_id, v_agent_uname, v_player_uname, v_player_uname, 'agent_debit', -v_sanitized_amt, v_player_bal - v_sanitized_amt);

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id,
    'new_player_balance', v_player_bal - v_sanitized_amt,
    'new_agent_balance', v_agent_bal + v_sanitized_amt
  );
END;
$$;


-- ============================================================================
-- 3. GLOBAL GAME ENGINE RPC PATCH (submit_round_bet & resolve_round)
-- ============================================================================

-- Fix submit_round_bet multi-deduction bug & add transaction ledger logging
CREATE OR REPLACE FUNCTION public.submit_round_bet(
  p_round_id    uuid,
  p_single_bets jsonb,
  p_double_bets jsonb,
  p_triple_bets jsonb,
  p_total_stake numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_balance       numeric;
  v_agent_id      uuid;
  v_username      text;
  v_round         public.game_rounds;
  v_existing_stake numeric := 0;
  v_delta_stake   numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated user' USING errcode = 'P0006';
  END IF;

  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id;
  IF v_round IS NULL THEN RAISE EXCEPTION 'Round not found' USING errcode = 'P0002'; END IF;
  IF v_round.status = 'complete' THEN RAISE EXCEPTION 'Round already complete' USING errcode = 'P0003'; END IF;

  -- Lock profile row
  SELECT balance, agent_id, username INTO v_balance, v_agent_id, v_username
    FROM public.profiles
    WHERE id = v_user_id
    FOR UPDATE;

  IF v_balance IS NULL THEN RAISE EXCEPTION 'Player not found' USING errcode = 'P0004'; END IF;

  -- Check existing round bet for delta calculation
  SELECT total_stake INTO v_existing_stake
    FROM public.round_bets
    WHERE round_id = p_round_id AND user_id = v_user_id;

  v_existing_stake := COALESCE(v_existing_stake, 0);
  v_delta_stake := p_total_stake - v_existing_stake;

  IF v_delta_stake > 0 AND v_balance < v_delta_stake THEN
    RAISE EXCEPTION 'Insufficient balance' USING errcode = 'P0001';
  END IF;

  -- Update balance by exact delta
  IF v_delta_stake != 0 THEN
    UPDATE public.profiles
      SET balance = balance - v_delta_stake, updated_at = NOW()
      WHERE id = v_user_id;

    -- Record in transactions ledger
    INSERT INTO public.transactions (user_id, agent_id, type, amount, balance_after)
      VALUES (v_user_id, v_agent_id, 'bet_stake', -v_delta_stake, v_balance - v_delta_stake);
  END IF;

  -- Upsert round bet
  INSERT INTO public.round_bets (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
    VALUES (p_round_id, v_user_id, p_single_bets, p_double_bets, p_triple_bets, p_total_stake)
    ON CONFLICT (round_id, user_id) DO UPDATE SET
      single_bets = excluded.single_bets,
      double_bets = excluded.double_bets,
      triple_bets = excluded.triple_bets,
      total_stake = excluded.total_stake;

  RETURN jsonb_build_object(
    'success', true,
    'balance_after', (SELECT balance FROM public.profiles WHERE id = v_user_id)
  );
END;
$$;


-- Patch resolve_round to add transaction ledger entries for win payouts
CREATE OR REPLACE FUNCTION public.resolve_round(
  p_round_id uuid,
  p_red      int,
  p_green    int,
  p_black    int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bet        record;
  v_sk         text;
  v_dk         text;
  v_tk         text;
  v_sw         numeric;
  v_dw         numeric;
  v_tw         numeric;
  v_tw_total   numeric;
  v_count      int := 0;
  v_new_bal    numeric;
  v_agent_id   uuid;
BEGIN
  v_sk := p_black::text;
  v_dk := lpad(((p_green*10)+p_black)::text, 2, '0');
  v_tk := lpad(((p_red*100)+(p_green*10)+p_black)::text, 3, '0');

  UPDATE public.game_rounds
    SET status = 'complete', red = p_red, green = p_green, black = p_black
    WHERE id = p_round_id;

  FOR v_bet IN SELECT rb.*, p.agent_id FROM public.round_bets rb JOIN public.profiles p ON p.id = rb.user_id WHERE rb.round_id = p_round_id AND rb.is_resolved = false LOOP
    v_sw := 0; v_dw := 0; v_tw := 0;

    IF v_bet.single_bets ? v_sk THEN v_sw := ((v_bet.single_bets->>v_sk)::numeric) * 9; END IF;
    IF v_bet.double_bets ? v_dk THEN v_dw := ((v_bet.double_bets->>v_dk)::numeric) * 90; END IF;
    IF v_bet.triple_bets ? v_tk THEN v_tw := ((v_bet.triple_bets->>v_tk)::numeric) * 900; END IF;

    v_tw_total := v_sw + v_dw + v_tw;

    UPDATE public.round_bets
      SET single_win = v_sw, double_win = v_dw, triple_win = v_tw, win_amount = v_tw_total, is_resolved = true
      WHERE id = v_bet.id;

    IF v_tw_total > 0 THEN
      UPDATE public.profiles
        SET balance = balance + v_tw_total, updated_at = NOW()
        WHERE id = v_bet.user_id
        RETURNING balance INTO v_new_bal;

      -- Record win payout in transactions ledger
      INSERT INTO public.transactions (user_id, agent_id, type, amount, balance_after)
        VALUES (v_bet.user_id, v_bet.agent_id, 'bet_payout', v_tw_total, v_new_bal);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'resolved_bets', v_count,
    'single_key', v_sk,
    'double_key', v_dk,
    'triple_key', v_tk
  );
END;
$$;
