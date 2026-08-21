-- Issue #44 FIX: agent_transfer_coins() locked the agent and player rows in
-- direction-dependent order -- 'credit' locked the agent first then the
-- player; 'debit' locked the player first then the agent. If a credit and a
-- debit for the same agent-player pair were ever submitted close enough
-- together, one call could hold the lock the other needs while waiting on
-- the lock the other holds -- a genuine deadlock (Postgres detects and
-- aborts one side automatically, so no data ever corrupts, but one of two
-- legitimate transfers fails with a confusing generic error).
--
-- Fix: the 'debit' branch's two apply_coin_movement() calls are reordered
-- so the agent locks first, matching 'credit''s existing order -- both
-- directions now lock in the same fixed order, so they can never contend
-- for the same two locks in opposite order again. Only the CALL ORDER
-- changes; the kind/amount/sign of each individual movement, and both
-- final return values (v_pbal/v_abal), are unchanged, since the two calls
-- are otherwise fully independent of each other.
--
-- Built as a surgical diff against the current live function (fetched
-- fresh via pg_get_functiondef immediately before writing this file, not
-- reconstructed from memory), matching the same discipline used for the
-- Issue #47 re-fix -- every other line is byte-for-byte unchanged.
--
-- Audited before writing: confirmed live that apply_coin_movement() locks
-- exactly one profiles row per call (its first argument, via
-- `SELECT ... FOR UPDATE`), so call order genuinely determines lock order.
-- Confirmed no other database function calls agent_transfer_coins() itself
-- (it's a direct RPC endpoint, single real caller in bsg_web_dashboard:
-- agent/players/actions.ts, which only reads the final JSON result -- no
-- dependency on internal execution order). Confirmed admin_issue_coins()
-- and place_bet() (the only other two callers of apply_coin_movement) each
-- call it exactly once per invocation, not twice, so neither shares this
-- bug class.

BEGIN;

CREATE OR REPLACE FUNCTION public.agent_transfer_coins(p_player_id uuid, p_amount bigint, p_direction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Issue #44 FIX: both branches now lock the agent's row before the
  -- player's row, regardless of direction -- previously only 'credit' did.
  IF p_direction = 'credit' THEN
    v_abal := public.apply_coin_movement(v_agent,     p_player_id, 'agent_ledger_debit',  -p_amount);
    v_pbal := public.apply_coin_movement(p_player_id, v_agent,     'agent_credit',         p_amount);
  ELSE
    v_abal := public.apply_coin_movement(v_agent,     p_player_id, 'agent_ledger_credit',  p_amount);
    v_pbal := public.apply_coin_movement(p_player_id, v_agent,     'agent_debit',         -p_amount);
  END IF;

  RETURN jsonb_build_object('success', true,
    'player_coin_balance', v_pbal, 'agent_coin_balance', v_abal);
END;
$function$;

COMMIT;
