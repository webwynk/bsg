-- Migration: 20260728030000_fix_all_coin_transfer_rpc_overloads.sql
-- Fixes RPC schema cache lookup errors by providing all overload signatures for money movement RPCs

-- ============================================================================
-- 1. transfer_coins_agent_to_player (Signature A: p_agent_id, p_player_id, p_amount)
-- ============================================================================
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
  v_sanitized_amt   NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
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
    RAISE EXCEPTION 'Insufficient agent coins balance. Available: %, Requested: %',
      v_agent_bal, v_sanitized_amt USING errcode = 'P0003';
  END IF;

  -- Lock player profile
  SELECT username, balance, agent_id INTO v_player_uname, v_player_bal, v_player_agent_id
    FROM public.profiles
    WHERE id = p_player_id
    FOR UPDATE;

  IF v_player_uname IS NULL THEN
    RAISE EXCEPTION 'Player profile not found' USING errcode = 'P0004';
  END IF;

  -- Security Scoping: If player is assigned to a different agent, reject
  IF v_player_agent_id IS NOT NULL AND v_player_agent_id != p_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: Player belongs to a different agent' USING errcode = 'P0005';
  END IF;

  -- Execute Balance Transfers (and set agent_id if unassigned)
  UPDATE public.profiles
    SET balance = balance - v_sanitized_amt, updated_at = NOW()
    WHERE id = p_agent_id;

  UPDATE public.profiles
    SET balance = balance + v_sanitized_amt,
        agent_id = COALESCE(agent_id, p_agent_id),
        updated_at = NOW()
    WHERE id = p_player_id;

  -- Insert Transaction Record into Ledger
  INSERT INTO public.transactions (user_id, agent_id, agent_username, user_name, user_username, type, amount, balance_after)
    VALUES (p_player_id, p_agent_id, v_agent_uname, v_player_uname, v_player_uname,
            'agent_credit', v_sanitized_amt, v_player_bal + v_sanitized_amt);

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id,
    'new_player_balance', v_player_bal + v_sanitized_amt,
    'new_agent_balance', v_agent_bal - v_sanitized_amt
  );
END;
$$;

-- ============================================================================
-- 2. transfer_coins_agent_to_player (Signature B Overload: p_agent_id, p_amount, p_player_id)
--    Matches callers that pass p_amount before p_player_id
-- ============================================================================
CREATE OR REPLACE FUNCTION public.transfer_coins_agent_to_player(
  p_agent_id  uuid,
  p_amount    numeric,
  p_player_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.transfer_coins_agent_to_player(p_agent_id, p_player_id, p_amount);
END;
$$;

-- ============================================================================
-- 3. withdraw_coins_player_to_agent (Signature A: p_agent_id, p_player_id, p_amount)
-- ============================================================================
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
  v_sanitized_amt   NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
BEGIN
  IF v_sanitized_amt <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING errcode = 'P0001';
  END IF;

  SELECT username, balance INTO v_agent_uname, v_agent_bal
    FROM public.profiles
    WHERE id = p_agent_id
    FOR UPDATE;

  IF v_agent_uname IS NULL THEN
    RAISE EXCEPTION 'Agent profile not found' USING errcode = 'P0002';
  END IF;

  SELECT username, balance, agent_id INTO v_player_uname, v_player_bal, v_player_agent_id
    FROM public.profiles
    WHERE id = p_player_id
    FOR UPDATE;

  IF v_player_uname IS NULL THEN
    RAISE EXCEPTION 'Player profile not found' USING errcode = 'P0004';
  END IF;

  IF v_player_bal < v_sanitized_amt THEN
    RAISE EXCEPTION 'Insufficient player coins balance. Available: %, Requested: %',
      v_player_bal, v_sanitized_amt USING errcode = 'P0003';
  END IF;

  IF v_player_agent_id IS NOT NULL AND v_player_agent_id != p_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: Player belongs to a different agent' USING errcode = 'P0005';
  END IF;

  UPDATE public.profiles
    SET balance = balance - v_sanitized_amt, updated_at = NOW()
    WHERE id = p_player_id;

  UPDATE public.profiles
    SET balance = balance + v_sanitized_amt, updated_at = NOW()
    WHERE id = p_agent_id;

  INSERT INTO public.transactions (user_id, agent_id, agent_username, user_name, user_username, type, amount, balance_after)
    VALUES (p_player_id, p_agent_id, v_agent_uname, v_player_uname, v_player_uname,
            'agent_debit', -v_sanitized_amt, v_player_bal - v_sanitized_amt);

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id,
    'new_player_balance', v_player_bal - v_sanitized_amt,
    'new_agent_balance', v_agent_bal + v_sanitized_amt
  );
END;
$$;

-- ============================================================================
-- 4. withdraw_coins_player_to_agent (Signature B Overload: p_agent_id, p_amount, p_player_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.withdraw_coins_player_to_agent(
  p_agent_id  uuid,
  p_amount    numeric,
  p_player_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.withdraw_coins_player_to_agent(p_agent_id, p_player_id, p_amount);
END;
$$;

-- ============================================================================
-- 5. issue_agent_coins (Signature A: p_admin_id, p_agent_id, p_amount, p_type)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.issue_agent_coins(
  p_admin_id uuid,
  p_agent_id uuid,
  p_amount   numeric,
  p_type     text DEFAULT 'deposit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_bal     NUMERIC;
  v_agent_uname   TEXT;
  v_sanitized_amt NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
  v_new_balance   NUMERIC;
BEGIN
  IF v_sanitized_amt <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING errcode = 'P0001';
  END IF;

  SELECT username, balance INTO v_agent_uname, v_agent_bal
    FROM public.profiles
    WHERE id = p_agent_id
    FOR UPDATE;

  IF v_agent_uname IS NULL THEN
    RAISE EXCEPTION 'Agent profile not found' USING errcode = 'P0002';
  END IF;

  IF p_type = 'withdraw' THEN
    IF v_agent_bal < v_sanitized_amt THEN
      RAISE EXCEPTION 'Insufficient agent balance to withdraw' USING errcode = 'P0003';
    END IF;
    v_new_balance := v_agent_bal - v_sanitized_amt;
  ELSE
    v_new_balance := v_agent_bal + v_sanitized_amt;
  END IF;

  UPDATE public.profiles
    SET balance = v_new_balance, updated_at = NOW()
    WHERE id = p_agent_id;

  INSERT INTO public.agent_coin_transactions (agent_id, agent_name, agent_username, admin_id, type, amount)
    VALUES (p_agent_id, v_agent_uname, v_agent_uname, p_admin_id, COALESCE(p_type, 'deposit'), v_sanitized_amt);

  RETURN jsonb_build_object(
    'success', true,
    'agent_id', p_agent_id,
    'new_balance', v_new_balance
  );
END;
$$;

-- ============================================================================
-- 6. issue_agent_coins (Signature B Overload: p_agent_id, p_amount)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.issue_agent_coins(
  p_agent_id uuid,
  p_amount   numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.issue_agent_coins(NULL, p_agent_id, p_amount, 'deposit');
END;
$$;

-- ============================================================================
-- 7. Reload PostgREST schema cache immediately
-- ============================================================================
NOTIFY pgrst, 'reload schema';
