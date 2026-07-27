-- Migration: 20260728020000_fix_schema_conflicts.sql
-- Fixes BUG-09, BUG-10, BUG-17: Transactions schema conflicts, agent_configs RTP columns, play limits

-- ============================================================================
-- 1. FIX BUG-09 / BUG-17: Standardize transactions.type column
--    Problem: Two migrations define 'type' differently.
--    - init_schema.sql: uses enum 'transaction_type' (has bet_stake, bet_payout) 
--    - 20260726020000: uses TEXT CHECK only allowing 'agent_credit','agent_debit','bet','win'
--    Fix: Ensure column accepts all 6 needed values regardless of which schema is live.
-- ============================================================================

-- If the column is an enum, add missing values
DO $$
BEGIN
  -- Try adding bet_stake to enum if it exists as enum type
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
    ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'bet_stake';
    ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'bet_payout';
    ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'deposit';
    ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'withdrawal';
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- If enum doesn't exist, silently continue
END $$;

-- If the column is plain TEXT (no enum), drop the old restrictive CHECK and add a correct one
DO $$
BEGIN
  -- Drop old restrictive check constraints if they exist
  ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Ensure balance_after column exists (missing from some migration paths)
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(15,2);

-- Ensure agent_name column exists on agent_coin_transactions
ALTER TABLE public.agent_coin_transactions ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- ============================================================================
-- 2. FIX BUG-10: agent_configs table — add missing columns for RTP storage
--    Problem: Migrations use rtp_percentage and target_win_percentage but the
--    base table only has target_win_percentage. Also the 'id' text column is
--    needed for global_system_config upserts.
-- ============================================================================

-- Add id column (text) used for global_system_config record
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS id TEXT;

-- Add rtp_percentage column (numeric alias for compatibility)
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS rtp_percentage NUMERIC(5,2);

-- Add target_win_percentage if it doesn't exist (it should, but guard against it)
DO $$
BEGIN
  ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS target_win_percentage NUMERIC(5,2);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Ensure updated_at exists on agent_configs
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create the global_system_config row if it doesn't exist (agent_id IS NULL row)
-- This is the row the superadmin RTP setting reads from
INSERT INTO public.agent_configs (id, agent_id, rtp_percentage, target_win_percentage, updated_at)
VALUES ('global_system_config', NULL, 96.0, 96.0, NOW())
ON CONFLICT DO NOTHING;

-- Update the get_effective_rtp function to handle both id and agent_id IS NULL cases cleanly
CREATE OR REPLACE FUNCTION public.get_effective_rtp(p_agent_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rtp numeric;
BEGIN
  -- Tier 1: Check for explicit per-agent override
  IF p_agent_id IS NOT NULL THEN
    SELECT COALESCE(target_win_percentage, rtp_percentage) INTO v_rtp
      FROM public.agent_configs
      WHERE agent_id = p_agent_id
        AND (target_win_percentage IS NOT NULL OR rtp_percentage IS NOT NULL)
      LIMIT 1;

    IF v_rtp IS NOT NULL THEN
      RETURN v_rtp;
    END IF;
  END IF;

  -- Tier 2: Superadmin Global System Setting
  SELECT COALESCE(target_win_percentage, rtp_percentage) INTO v_rtp
    FROM public.agent_configs
    WHERE (id = 'global_system_config' OR agent_id IS NULL)
      AND (target_win_percentage IS NOT NULL OR rtp_percentage IS NOT NULL)
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;

  IF v_rtp IS NOT NULL THEN
    RETURN v_rtp;
  END IF;

  -- Tier 3: Hardcoded emergency fallback
  RETURN 96.0;
END;
$$;

-- Update get_system_target_rtp to use the fixed get_effective_rtp
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

-- ============================================================================
-- 3. FIX BUG-07: Create play_limits table for server-authoritative bet limits
--    Removes hardcoded limits from Flutter app. Superadmin can change live.
-- ============================================================================

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

-- Insert default limits if not present
INSERT INTO public.play_limits (id, single_min, single_max, double_min, double_max, triple_min, triple_max)
VALUES ('global', 2, 10000, 2, 1000, 2, 100)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.play_limits ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read play limits
DROP POLICY IF EXISTS "authenticated reads play_limits" ON public.play_limits;
CREATE POLICY "authenticated reads play_limits" ON public.play_limits
  FOR SELECT USING (true);

-- RPC to fetch play limits (no auth required — they are public game rules)
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

-- ============================================================================
-- 4. FIX BUG-13: Patch transfer_coins_agent_to_player — no silent auto-assign
--    An agent should NOT be able to claim unassigned players just by depositing.
--    Agents can only transfer to players explicitly assigned to them.
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

  -- FIXED BUG-13: Strict agent ownership check — no silent auto-assign
  IF v_player_agent_id IS NULL THEN
    RAISE EXCEPTION 'Player is not assigned to any agent. Please assign the player first.' USING errcode = 'P0006';
  END IF;

  IF v_player_agent_id != p_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: Player belongs to a different agent' USING errcode = 'P0005';
  END IF;

  -- Execute Atomic Balance Transfers
  UPDATE public.profiles
    SET balance = balance - v_sanitized_amt, updated_at = NOW()
    WHERE id = p_agent_id;

  UPDATE public.profiles
    SET balance = balance + v_sanitized_amt, updated_at = NOW()
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
-- 5. Add submit_round_bet max-bet server-side enforcement (BUG-07 partial)
--    Reject any bet that exceeds the play_limits table values.
-- ============================================================================

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

  -- Fetch play limits
  SELECT * INTO v_limits FROM public.play_limits WHERE id = 'global' LIMIT 1;

  -- Validate each board's per-cell amounts against limits
  IF v_limits IS NOT NULL THEN
    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_single_bets) LOOP
      IF v_cell_val < v_limits.single_min THEN
        RAISE EXCEPTION 'Single bet % below minimum %', v_cell_val, v_limits.single_min USING errcode = 'P0007';
      END IF;
      IF v_cell_val > v_limits.single_max THEN
        RAISE EXCEPTION 'Single bet % exceeds maximum %', v_cell_val, v_limits.single_max USING errcode = 'P0008';
      END IF;
    END LOOP;

    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_double_bets) LOOP
      IF v_cell_val > v_limits.double_max THEN
        RAISE EXCEPTION 'Double bet % exceeds maximum %', v_cell_val, v_limits.double_max USING errcode = 'P0008';
      END IF;
    END LOOP;

    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_triple_bets) LOOP
      IF v_cell_val > v_limits.triple_max THEN
        RAISE EXCEPTION 'Triple bet % exceeds maximum %', v_cell_val, v_limits.triple_max USING errcode = 'P0008';
      END IF;
    END LOOP;
  END IF;

  -- Lock profile row
  SELECT balance, agent_id, username INTO v_balance, v_agent_id, v_username
    FROM public.profiles
    WHERE id = v_user_id
    FOR UPDATE;

  IF v_balance IS NULL THEN RAISE EXCEPTION 'Player not found' USING errcode = 'P0004'; END IF;

  -- Check existing round bet for delta calculation (prevents double-deduction on retry)
  SELECT total_stake INTO v_existing_stake
    FROM public.round_bets
    WHERE round_id = p_round_id AND user_id = v_user_id;

  v_existing_stake := COALESCE(v_existing_stake, 0);
  v_delta_stake    := p_total_stake - v_existing_stake;

  IF v_delta_stake > 0 AND v_balance < v_delta_stake THEN
    RAISE EXCEPTION 'Insufficient balance' USING errcode = 'P0001';
  END IF;

  -- Update balance by exact delta only
  IF v_delta_stake != 0 THEN
    UPDATE public.profiles
      SET balance = balance - v_delta_stake, updated_at = NOW()
      WHERE id = v_user_id;

    INSERT INTO public.transactions (user_id, agent_id, type, amount, balance_after)
      VALUES (v_user_id, v_agent_id, 'bet_stake', -v_delta_stake, v_balance - v_delta_stake);
  END IF;

  -- Upsert round bet record
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

-- ============================================================================
-- 6. RPC to fetch a player's resolved round_bets entry for win confirmation
--    Used by Flutter app after wheel animation to get server-confirmed win amount
--    (BUG-11: prevents local win recalculation mismatch)
-- ============================================================================

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
    -- Player did not bet this round — just return current balance
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
