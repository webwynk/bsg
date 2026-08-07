-- ============================================================================
-- Fix: blocked/deactivated agent or superadmin accounts could still transfer
-- or mint coins.
--
-- ROOT CAUSE
--
-- agent_transfer_coins() and admin_issue_coins() authorized the caller via:
--   SELECT role INTO v_role FROM profiles WHERE id = v_caller AND is_active;
--   IF v_role NOT IN ('agent','superadmin') THEN RAISE EXCEPTION ...
--
-- When the caller's account is deactivated, "WHERE id = v_caller AND
-- is_active" matches zero rows, so v_role becomes NULL -- not false, not an
-- error. PL/pgSQL evaluates `IF NULL NOT IN (...) THEN` as NULL, and treats a
-- NULL condition identically to false, so the RAISE EXCEPTION is silently
-- skipped and the function proceeds as if the caller were a legitimate,
-- active agent/superadmin.
--
-- Every other RPC in this codebase (place_bet, session_login,
-- session_heartbeat) checks is_active correctly -- select first, check the
-- boolean explicitly afterward. Only these two cashier functions used the
-- flawed combined-query shortcut.
--
-- FIX
--
-- Select role and is_active as two separate values, then check both
-- explicitly. A blocked caller with a real, findable profile row is now
-- correctly and explicitly rejected instead of silently waved through.
--
-- This is a CREATE OR REPLACE with the same signature -- no GRANT/REVOKE
-- changes needed, no call-site changes needed. Behavior for an active
-- agent/superadmin is unchanged.
--
-- This is Layer A of a two-layer fix. Layer B (application-side: revoking
-- the account's actual Supabase Auth session the moment it's blocked, via
-- ban_duration in setAgentActiveAction / setPlayerActiveAction) ships
-- separately in bsg_web_dashboard and is not part of this migration.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.agent_transfer_coins(
  p_player_id UUID,
  p_amount    BIGINT,
  p_direction TEXT           -- 'credit' (agent->player) | 'debit' (player->agent)
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller  UUID := auth.uid();
  v_role    TEXT;
  v_active  BOOLEAN;
  v_player  public.profiles;
  v_agent   UUID;
  v_pbal BIGINT; v_abal BIGINT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be a positive whole number' USING errcode = 'P0130';
  END IF;
  IF p_direction NOT IN ('credit','debit') THEN
    RAISE EXCEPTION 'direction must be credit or debit' USING errcode = 'P0131';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS NULL OR v_active IS NOT TRUE OR v_role NOT IN ('agent','superadmin') THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING errcode = 'P0132';
  END IF;

  SELECT * INTO v_player FROM public.profiles WHERE id = p_player_id;
  IF NOT FOUND OR v_player.role <> 'player' THEN
    RAISE EXCEPTION 'Player not found' USING errcode = 'P0133';
  END IF;

  -- An agent may only move coins for their own players.
  IF v_role = 'agent' AND v_player.agent_id <> v_caller THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NOT_YOUR_PLAYER' USING errcode = 'P0134';
  END IF;
  v_agent := v_player.agent_id;

  IF p_direction = 'credit' THEN
    v_abal := public.apply_coin_movement(v_agent,     p_player_id, 'admin_debit',  -p_amount);
    v_pbal := public.apply_coin_movement(p_player_id, v_agent,     'agent_credit',  p_amount);
  ELSE
    v_pbal := public.apply_coin_movement(p_player_id, v_agent,     'agent_debit',  -p_amount);
    v_abal := public.apply_coin_movement(v_agent,     p_player_id, 'admin_credit',  p_amount);
  END IF;

  RETURN jsonb_build_object('success', true,
    'player_coin_balance', v_pbal, 'agent_coin_balance', v_abal);
END;
$$;


-- Superadmin -> agent. Coins are created/destroyed at this boundary, so this
-- is the only function that can increase the total money in the system.
CREATE OR REPLACE FUNCTION public.admin_issue_coins(
  p_agent_id  UUID,
  p_amount    BIGINT,
  p_direction TEXT           -- 'credit' | 'debit'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_role   TEXT;
  v_active BOOLEAN;
  v_agent  public.profiles;
  v_bal    BIGINT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be a positive whole number' USING errcode = 'P0130';
  END IF;
  IF p_direction NOT IN ('credit','debit') THEN
    RAISE EXCEPTION 'direction must be credit or debit' USING errcode = 'P0131';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS NULL OR v_active IS NOT TRUE OR v_role <> 'superadmin' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SUPERADMIN_ONLY' USING errcode = 'P0135';
  END IF;

  SELECT * INTO v_agent FROM public.profiles WHERE id = p_agent_id;
  IF NOT FOUND OR v_agent.role <> 'agent' THEN
    RAISE EXCEPTION 'Agent not found' USING errcode = 'P0136';
  END IF;

  v_bal := public.apply_coin_movement(
    p_agent_id, v_caller,
    CASE WHEN p_direction = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END,
    CASE WHEN p_direction = 'credit' THEN p_amount ELSE -p_amount END);

  INSERT INTO public.audit_log (actor_id, kind, detail)
  VALUES (v_caller, 'coin',
    format('%s %s coins %s agent @%s',
      initcap(p_direction), p_amount,
      CASE WHEN p_direction='credit' THEN 'to' ELSE 'from' END, v_agent.username));

  RETURN jsonb_build_object('success', true, 'agent_coin_balance', v_bal);
END;
$$;

COMMIT;
