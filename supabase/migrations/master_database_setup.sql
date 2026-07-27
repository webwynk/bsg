-- ============================================================================
-- BEST SMART GAME (BSG) — MASTER DATABASE CONSOLIDATED SETUP SCRIPT
-- Copy & Paste this entire script into your Supabase Dashboard SQL Editor to
-- fix all schema drift, missing columns, RPC signatures, and bad triggers.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. DROP BAD TRIGGERS THAT OVERWRITE BALANCE WITH STALE AUTH METADATA
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_user_metadata_balance ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_user_metadata_balance();

-- Helper updated_at function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. CREATE / VERIFY ALL 10 DATABASE TABLES & COLUMNS
-- ----------------------------------------------------------------------------

-- A. public.profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'player' CHECK (role IN ('super_admin', 'agent', 'player')),
    username VARCHAR(64) UNIQUE NOT NULL,
    agent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    balance NUMERIC(15,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'player';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS agent_id UUID;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- B. public.agent_configs
CREATE TABLE IF NOT EXISTS public.agent_configs (
    id TEXT,
    agent_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    rtp NUMERIC(5,2) NOT NULL DEFAULT 96.50 CHECK (rtp >= 0 AND rtp <= 100),
    rtp_percentage NUMERIC(5,2) DEFAULT 96.50,
    target_win_percentage NUMERIC(5,2) DEFAULT 96.50,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS id TEXT;
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS rtp_percentage NUMERIC(5,2);
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS target_win_percentage NUMERIC(5,2);
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Seed global RTP config row
INSERT INTO public.agent_configs (id, agent_id, rtp, rtp_percentage, target_win_percentage, updated_at)
VALUES ('global_system_config', NULL, 96.0, 96.0, 96.0, NOW())
ON CONFLICT DO NOTHING;

-- C. public.transactions (Agent <-> Player Cashier Ledger)
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    agent_username VARCHAR(64),
    user_name VARCHAR(64),
    user_username VARCHAR(64) NOT NULL,
    type VARCHAR(32) NOT NULL,
    amount NUMERIC(15,2) NOT NULL,
    balance_after NUMERIC(15,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS agent_username VARCHAR(64);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS user_name VARCHAR(64);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(15,2);

-- D. public.agent_coin_transactions (Superadmin <-> Agent Minting Ledger)
CREATE TABLE IF NOT EXISTS public.agent_coin_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    admin_id UUID,
    agent_name VARCHAR(64),
    agent_username VARCHAR(64) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdraw')),
    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.agent_coin_transactions ADD COLUMN IF NOT EXISTS agent_name VARCHAR(64);
ALTER TABLE public.agent_coin_transactions ADD COLUMN IF NOT EXISTS admin_id UUID;

-- E. public.game_history
CREATE TABLE IF NOT EXISTS public.game_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    bet_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    win_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- F. public.game_rounds
CREATE TABLE IF NOT EXISTS public.game_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_number BIGINT UNIQUE NOT NULL,
    start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_time TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '60 seconds'),
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    winning_outer INT CHECK (winning_outer BETWEEN 0 AND 9),
    winning_middle INT CHECK (winning_middle BETWEEN 0 AND 9),
    winning_inner INT CHECK (winning_inner BETWEEN 0 AND 9),
    red INT CHECK (red BETWEEN 0 AND 9),
    green INT CHECK (green BETWEEN 0 AND 9),
    black INT CHECK (black BETWEEN 0 AND 9),
    status VARCHAR(20) NOT NULL DEFAULT 'betting',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS red INT;
ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS green INT;
ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS black INT;
ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NOW();

-- G. public.round_bets
CREATE TABLE IF NOT EXISTS public.round_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID REFERENCES public.game_rounds(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    round_number BIGINT,
    single_bets JSONB NOT NULL DEFAULT '{}'::jsonb,
    double_bets JSONB NOT NULL DEFAULT '{}'::jsonb,
    triple_bets JSONB NOT NULL DEFAULT '{}'::jsonb,
    total_bet NUMERIC(15,2) DEFAULT 0.00,
    total_stake NUMERIC(15,2) DEFAULT 0.00,
    win_amount NUMERIC(15,2) DEFAULT 0.00,
    single_win NUMERIC(15,2) DEFAULT 0.00,
    double_win NUMERIC(15,2) DEFAULT 0.00,
    triple_win NUMERIC(15,2) DEFAULT 0.00,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT round_bets_round_user_unique UNIQUE (round_id, user_id)
);

ALTER TABLE public.round_bets ADD COLUMN IF NOT EXISTS total_stake NUMERIC(15,2) DEFAULT 0.00;
ALTER TABLE public.round_bets ADD COLUMN IF NOT EXISTS single_win NUMERIC(15,2) DEFAULT 0.00;
ALTER TABLE public.round_bets ADD COLUMN IF NOT EXISTS double_win NUMERIC(15,2) DEFAULT 0.00;
ALTER TABLE public.round_bets ADD COLUMN IF NOT EXISTS triple_win NUMERIC(15,2) DEFAULT 0.00;
ALTER TABLE public.round_bets ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN DEFAULT FALSE;

-- H. public.active_sessions
CREATE TABLE IF NOT EXISTS public.active_sessions (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- I. public.audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor VARCHAR(64) NOT NULL DEFAULT 'System',
    type VARCHAR(32) NOT NULL,
    detail TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- J. public.play_limits
CREATE TABLE IF NOT EXISTS public.play_limits (
    id TEXT PRIMARY KEY DEFAULT 'global',
    single_min NUMERIC(15,2) NOT NULL DEFAULT 2,
    single_max NUMERIC(15,2) NOT NULL DEFAULT 10000,
    double_min NUMERIC(15,2) NOT NULL DEFAULT 2,
    double_max NUMERIC(15,2) NOT NULL DEFAULT 1000,
    triple_min NUMERIC(15,2) NOT NULL DEFAULT 2,
    triple_max NUMERIC(15,2) NOT NULL DEFAULT 100,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.play_limits (id, single_min, single_max, double_min, double_max, triple_min, triple_max)
VALUES ('global', 2, 10000, 2, 1000, 2, 100)
ON CONFLICT (id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 3. SECURITY DEFINER RPC FUNCTIONS (WITH ALL PARAMETER OVERLOADS)
-- ----------------------------------------------------------------------------

-- A. get_effective_rtp
CREATE OR REPLACE FUNCTION public.get_effective_rtp(p_agent_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rtp numeric;
BEGIN
  IF p_agent_id IS NOT NULL THEN
    SELECT COALESCE(target_win_percentage, rtp_percentage, rtp) INTO v_rtp
      FROM public.agent_configs
      WHERE agent_id = p_agent_id
        AND (target_win_percentage IS NOT NULL OR rtp_percentage IS NOT NULL OR rtp IS NOT NULL)
      LIMIT 1;

    IF v_rtp IS NOT NULL THEN
      RETURN v_rtp;
    END IF;
  END IF;

  SELECT COALESCE(target_win_percentage, rtp_percentage, rtp) INTO v_rtp
    FROM public.agent_configs
    WHERE (id = 'global_system_config' OR agent_id IS NULL)
      AND (target_win_percentage IS NOT NULL OR rtp_percentage IS NOT NULL OR rtp IS NOT NULL)
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;

  IF v_rtp IS NOT NULL THEN
    RETURN v_rtp;
  END IF;

  RETURN 96.0;
END;
$$;

-- B. get_system_target_rtp
CREATE OR REPLACE FUNCTION public.get_system_target_rtp()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN FLOOR(public.get_effective_rtp(NULL))::integer;
END;
$$;

-- C. issue_agent_coins (4-param signature)
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

-- C2. issue_agent_coins (2-param overload signature)
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

-- D. transfer_coins_agent_to_player (Signature A: p_agent_id, p_player_id, p_amount)
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

  SELECT username, balance, agent_id INTO v_player_uname, v_player_bal, v_player_agent_id
    FROM public.profiles
    WHERE id = p_player_id
    FOR UPDATE;

  IF v_player_uname IS NULL THEN
    RAISE EXCEPTION 'Player profile not found' USING errcode = 'P0004';
  END IF;

  IF v_player_agent_id IS NOT NULL AND v_player_agent_id != p_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: Player belongs to a different agent' USING errcode = 'P0005';
  END IF;

  UPDATE public.profiles
    SET balance = balance - v_sanitized_amt, updated_at = NOW()
    WHERE id = p_agent_id;

  UPDATE public.profiles
    SET balance = balance + v_sanitized_amt,
        agent_id = COALESCE(agent_id, p_agent_id),
        updated_at = NOW()
    WHERE id = p_player_id;

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

-- D2. transfer_coins_agent_to_player (Signature B Overload: p_agent_id, p_amount, p_player_id)
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

-- E. withdraw_coins_player_to_agent (Signature A: p_agent_id, p_player_id, p_amount)
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

-- E2. withdraw_coins_player_to_agent (Signature B Overload: p_agent_id, p_amount, p_player_id)
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

-- F. check_and_update_login_session
CREATE OR REPLACE FUNCTION public.check_and_update_login_session(
  p_user_id       uuid,
  p_session_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_token text;
BEGIN
  SELECT session_token INTO v_existing_token
    FROM public.active_sessions
    WHERE user_id = p_user_id;

  IF p_session_token IS NULL OR p_session_token = '' THEN
    UPDATE public.active_sessions SET last_seen_at = NOW() WHERE user_id = p_user_id;
    RETURN jsonb_build_object('allowed', true, 'status', 'active');
  END IF;

  IF v_existing_token IS NULL THEN
    INSERT INTO public.active_sessions (user_id, session_token, last_seen_at)
      VALUES (p_user_id, p_session_token, NOW())
      ON CONFLICT (user_id) DO UPDATE SET session_token = p_session_token, last_seen_at = NOW();
    RETURN jsonb_build_object('allowed', true, 'status', 'session_created');
  ELSIF v_existing_token = p_session_token THEN
    UPDATE public.active_sessions SET last_seen_at = NOW() WHERE user_id = p_user_id;
    RETURN jsonb_build_object('allowed', true, 'status', 'session_valid');
  ELSE
    UPDATE public.active_sessions SET session_token = p_session_token, last_seen_at = NOW() WHERE user_id = p_user_id;
    RETURN jsonb_build_object('allowed', true, 'status', 'session_superseded');
  END IF;
END;
$$;

-- G. get_current_round
CREATE OR REPLACE FUNCTION public.get_current_round()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now                TIMESTAMPTZ := NOW();
  v_epoch              BIGINT := EXTRACT(EPOCH FROM v_now)::BIGINT;
  v_round_num          BIGINT := v_epoch / 60;
  v_seconds_into_round INT := (v_epoch % 60)::INT;
  v_time_remaining     INT := 50 - v_seconds_into_round;
  v_status             TEXT;
  v_round_id           UUID;
  v_red                INT;
  v_green              INT;
  v_black              INT;
BEGIN
  IF v_seconds_into_round < 50 THEN
    v_status := 'betting';
  ELSE
    v_time_remaining := 0;
    v_status := 'spinning';
  END IF;

  SELECT id, red, green, black INTO v_round_id, v_red, v_green, v_black
    FROM public.game_rounds
    WHERE round_number = v_round_num;

  IF v_round_id IS NULL THEN
    INSERT INTO public.game_rounds (round_number, start_time, end_time, scheduled_at, status)
      VALUES (v_round_num, v_now, v_now + INTERVAL '60 seconds', v_now + INTERVAL '50 seconds', v_status)
      ON CONFLICT (round_number) DO NOTHING;

    SELECT id INTO v_round_id FROM public.game_rounds WHERE round_number = v_round_num;
  END IF;

  RETURN jsonb_build_object(
    'round_id',          v_round_id,
    'round_number',      v_round_num,
    'status',            v_status,
    'scheduled_at',      v_now + (v_time_remaining || ' seconds')::INTERVAL,
    'seconds_remaining', GREATEST(0, v_time_remaining),
    'red',               v_red,
    'green',             v_green,
    'black',             v_black
  );
END;
$$;

-- H. submit_round_bet
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
  v_user_id        uuid := auth.uid();
  v_balance        numeric;
  v_agent_id       uuid;
  v_username       text;
  v_round          public.game_rounds;
  v_existing_stake numeric := 0;
  v_delta_stake    numeric;
  v_limits         public.play_limits;
  v_cell_val       numeric;
  v_cell_key       text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated user' USING errcode = 'P0006';
  END IF;

  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id;
  IF v_round IS NULL THEN RAISE EXCEPTION 'Round not found' USING errcode = 'P0002'; END IF;
  IF v_round.status = 'complete' THEN RAISE EXCEPTION 'Round already complete' USING errcode = 'P0003'; END IF;

  SELECT * INTO v_limits FROM public.play_limits WHERE id = 'global' LIMIT 1;

  IF v_limits IS NOT NULL THEN
    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_single_bets) LOOP
      IF v_cell_val < v_limits.single_min THEN RAISE EXCEPTION 'Single bet % below min %', v_cell_val, v_limits.single_min USING errcode = 'P0007'; END IF;
      IF v_cell_val > v_limits.single_max THEN RAISE EXCEPTION 'Single bet % exceeds max %', v_cell_val, v_limits.single_max USING errcode = 'P0008'; END IF;
    END LOOP;

    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_double_bets) LOOP
      IF v_cell_val > v_limits.double_max THEN RAISE EXCEPTION 'Double bet % exceeds max %', v_cell_val, v_limits.double_max USING errcode = 'P0008'; END IF;
    END LOOP;

    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_triple_bets) LOOP
      IF v_cell_val > v_limits.triple_max THEN RAISE EXCEPTION 'Triple bet % exceeds max %', v_cell_val, v_limits.triple_max USING errcode = 'P0008'; END IF;
    END LOOP;
  END IF;

  SELECT balance, agent_id, username INTO v_balance, v_agent_id, v_username
    FROM public.profiles
    WHERE id = v_user_id
    FOR UPDATE;

  IF v_balance IS NULL THEN RAISE EXCEPTION 'Player not found' USING errcode = 'P0004'; END IF;

  SELECT total_stake INTO v_existing_stake
    FROM public.round_bets
    WHERE round_id = p_round_id AND user_id = v_user_id;

  v_existing_stake := COALESCE(v_existing_stake, 0);
  v_delta_stake    := p_total_stake - v_existing_stake;

  IF v_delta_stake > 0 AND v_balance < v_delta_stake THEN
    RAISE EXCEPTION 'Insufficient balance' USING errcode = 'P0001';
  END IF;

  IF v_delta_stake != 0 THEN
    UPDATE public.profiles
      SET balance = balance - v_delta_stake, updated_at = NOW()
      WHERE id = v_user_id;

    INSERT INTO public.transactions (user_id, agent_id, type, amount, balance_after)
      VALUES (v_user_id, v_agent_id, 'bet_stake', -v_delta_stake, v_balance - v_delta_stake);
  END IF;

  INSERT INTO public.round_bets (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
    VALUES (p_round_id, v_user_id, p_single_bets, p_double_bets, p_triple_bets, p_total_stake)
    ON CONFLICT (round_id, user_id) DO UPDATE SET
      single_bets  = excluded.single_bets,
      double_bets  = excluded.double_bets,
      triple_bets  = excluded.triple_bets,
      total_stake  = excluded.total_stake;

  RETURN jsonb_build_object(
    'success', true,
    'balance_after', (SELECT balance FROM public.profiles WHERE id = v_user_id)
  );
END;
$$;

-- I. get_my_round_result
CREATE OR REPLACE FUNCTION public.get_my_round_result(p_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_bet     record;
  v_balance numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0006';
  END IF;

  SELECT rb.*, p.balance
    INTO v_bet
    FROM public.round_bets rb
    JOIN public.profiles p ON p.id = v_user_id
    WHERE rb.round_id = p_round_id AND rb.user_id = v_user_id
    LIMIT 1;

  IF NOT FOUND THEN
    SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user_id;
    RETURN jsonb_build_object(
      'placed_bet', false,
      'win_amount', 0,
      'total_stake', 0,
      'balance', v_balance
    );
  END IF;

  RETURN jsonb_build_object(
    'placed_bet',   true,
    'win_amount',   v_bet.win_amount,
    'single_win',   v_bet.single_win,
    'double_win',   v_bet.double_win,
    'triple_win',   v_bet.triple_win,
    'total_stake',  v_bet.total_stake,
    'is_resolved',  v_bet.is_resolved,
    'balance',      v_bet.balance
  );
END;
$$;

-- J. get_play_limits
CREATE OR REPLACE FUNCTION public.get_play_limits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.play_limits;
BEGIN
  SELECT * INTO v_row FROM public.play_limits WHERE id = 'global' LIMIT 1;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object(
      'single', jsonb_build_object('min', 2, 'max', 10000),
      'double', jsonb_build_object('min', 2, 'max', 1000),
      'triple', jsonb_build_object('min', 2, 'max', 100)
    );
  END IF;

  RETURN jsonb_build_object(
    'single', jsonb_build_object('min', v_row.single_min, 'max', v_row.single_max),
    'double', jsonb_build_object('min', v_row.double_min, 'max', v_row.double_max),
    'triple', jsonb_build_object('min', v_row.triple_min, 'max', v_row.triple_max)
  );
END;
$$;

-- K. get_recent_rounds
CREATE OR REPLACE FUNCTION public.get_recent_rounds(p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb;
BEGIN
  SELECT jsonb_agg(r) INTO v_results
  FROM (
    SELECT id, round_number, red, green, black, scheduled_at, created_at
    FROM public.game_rounds
    WHERE status = 'complete' OR (red IS NOT NULL AND green IS NOT NULL AND black IS NOT NULL)
    ORDER BY round_number DESC
    LIMIT LEAST(p_limit, 50)
  ) r;

  RETURN COALESCE(v_results, '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_coin_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.play_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "game_rounds_select_policy" ON public.game_rounds;
CREATE POLICY "game_rounds_select_policy" ON public.game_rounds FOR SELECT USING (true);

DROP POLICY IF EXISTS "round_bets_select_policy" ON public.round_bets;
CREATE POLICY "round_bets_select_policy" ON public.round_bets FOR SELECT USING (true);

DROP POLICY IF EXISTS "transactions_select_policy" ON public.transactions;
CREATE POLICY "transactions_select_policy" ON public.transactions FOR SELECT USING (true);

DROP POLICY IF EXISTS "agent_coin_transactions_select_policy" ON public.agent_coin_transactions;
CREATE POLICY "agent_coin_transactions_select_policy" ON public.agent_coin_transactions FOR SELECT USING (true);

DROP POLICY IF EXISTS "play_limits_select_policy" ON public.play_limits;
CREATE POLICY "play_limits_select_policy" ON public.play_limits FOR SELECT USING (true);

-- ----------------------------------------------------------------------------
-- 5. RELOAD POSTGREST SCHEMA CACHE IMMEDIATELY
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
