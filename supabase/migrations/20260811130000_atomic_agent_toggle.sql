-- Fix: setAgentActiveAction performed the agent-block cascade (flip agent ->
-- read players -> flip players -> clear sessions -> write audit log) as
-- several independent, sequentially-erroring writes with no transaction
-- wrapping them. A failure partway through (e.g. a transient network blip
-- after 15 of 40 players updated) left the agent already flipped but only
-- some of their players cascaded -- a narrower version of the exact "M-1"
-- bug (blocked agents not actually losing effective access, since their
-- players kept playing) the cascade was originally built to prevent.
--
-- FIX
--
-- Move everything Postgres can actually guarantee atomically -- the agent's
-- own flip, the player cascade, active_sessions cleanup, and the audit log
-- entry -- into one SECURITY DEFINER RPC. Because the whole body runs in one
-- implicit transaction, a failure anywhere in it automatically rolls back
-- everything, including parts that already technically succeeded. Same
-- architectural pattern already used correctly for coin movement
-- (apply_coin_movement / agent_transfer_coins / admin_issue_coins).
--
-- NOT included here (and not includable): the Supabase Auth `ban_duration`
-- revocation calls setAgentActiveAction also makes. Those hit Supabase's
-- Auth admin API, a separate system from Postgres, so they structurally
-- cannot join this SQL transaction. They remain a best-effort step in
-- bsg_web_dashboard, run after this RPC succeeds, using the player IDs this
-- RPC returns. This is an accepted, already-safe gap: even if a ban call
-- fails for some accounts, agent_transfer_coins/admin_issue_coins already
-- reject any caller whose profiles.is_active is false (Issue #1's fix) --
-- so a still-valid JWT from a skipped ban still cannot move or mint coins.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_agent_active(p_agent_id UUID, p_active BOOLEAN)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_role       TEXT;
  v_active     BOOLEAN;
  v_agent      public.profiles;
  v_player_ids UUID[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS NULL OR v_active IS NOT TRUE OR v_role <> 'superadmin' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SUPERADMIN_ONLY' USING errcode = 'P0135';
  END IF;

  SELECT * INTO v_agent FROM public.profiles WHERE id = p_agent_id AND role = 'agent' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found' USING errcode = 'P0136';
  END IF;

  -- Same guard setAgentActiveAction already enforced in TS -- moved
  -- server-side so it can't be raced by a stale client read of auto_locked_at.
  IF p_active AND v_agent.auto_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'AGENT_AUTO_LOCKED_RESET_PASSWORD_REQUIRED' USING errcode = 'P0137';
  END IF;

  -- Reactivating also clears failed_login_attempts/auto_locked_at, so an
  -- agent manually unblocked for an unrelated reason doesn't resume halfway
  -- toward the automatic 5-strike lockout from before. Deactivating leaves
  -- those columns untouched.
  UPDATE public.profiles
     SET is_active = p_active,
         failed_login_attempts = CASE WHEN p_active THEN 0 ELSE failed_login_attempts END,
         auto_locked_at        = CASE WHEN p_active THEN NULL ELSE auto_locked_at END,
         updated_at = NOW()
   WHERE id = p_agent_id;

  -- Cascade to the agent's players, in both directions.
  SELECT array_agg(id) INTO v_player_ids FROM public.profiles WHERE agent_id = p_agent_id;

  IF v_player_ids IS NOT NULL THEN
    UPDATE public.profiles SET is_active = p_active, updated_at = NOW()
     WHERE id = ANY(v_player_ids);
  END IF;

  -- End live sessions for everyone just blocked, so nobody keeps playing.
  IF NOT p_active THEN
    DELETE FROM public.active_sessions
     WHERE user_id = p_agent_id OR user_id = ANY(COALESCE(v_player_ids, ARRAY[]::UUID[]));
  END IF;

  INSERT INTO public.audit_log (actor_id, kind, detail)
  VALUES (v_caller, 'security',
    format('%s agent @%s and %s player account(s)',
      CASE WHEN p_active THEN 'Unblocked' ELSE 'Blocked' END,
      v_agent.username, COALESCE(array_length(v_player_ids, 1), 0)));

  -- cascaded_player_ids lets the caller (bsg_web_dashboard) still run the
  -- Supabase Auth ban_duration calls for exactly the accounts this RPC
  -- actually cascaded to -- that part can't live inside this transaction.
  RETURN jsonb_build_object(
    'success', true,
    'is_active', p_active,
    'username', v_agent.username,
    'cascaded_player_ids', COALESCE(to_jsonb(v_player_ids), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_agent_active(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_active(UUID, BOOLEAN) TO authenticated;

COMMIT;
