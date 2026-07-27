-- Migration: 20260728010000_consolidate_multiplayer_and_fix_rtp.sql
-- Description: Enforces authoritative Superadmin RTP resolution chain and disables legacy single-player process_bet RPC.

-- 1. Create or replace get_effective_rtp helper function
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

  -- Tier 2: Superadmin Global System Setting (agent_id IS NULL or id = 'global_system_config')
  SELECT COALESCE(target_win_percentage, rtp_percentage) INTO v_rtp
    FROM public.agent_configs
    WHERE agent_id IS NULL OR id = 'global_system_config'
    ORDER BY updated_at DESC
    LIMIT 1;

  IF v_rtp IS NOT NULL THEN
    RETURN v_rtp;
  END IF;

  -- Tier 3: Hardcoded emergency fallback default
  RETURN 96.0;
END;
$$;

-- 2. Update get_system_target_rtp to wrap get_effective_rtp
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

-- 3. Safely disable legacy single-player process_bet RPC to ensure 100% multiplayer round consolidation
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
BEGIN
  RAISE EXCEPTION 'Single player process_bet is deprecated. All bets must be submitted to multiplayer global rounds via submit_round_bet.'
    USING errcode = 'P0001';
END;
$$;
