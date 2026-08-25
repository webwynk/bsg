-- Issue #93: requireAuth() (src/lib/auth-guard.ts) previously paid 3 fully
-- separate DB round-trips on every single server action call -- auth.getUser()
-- [unchanged, stays separate], an admin-client profiles select, and a
-- separate staff_session_touch RPC call -- with zero sharing across the
-- several actions a single page load or 3-second poll cycle fires. Confirmed
-- live (Issue #93 investigation) that this, multiplied across 2-3 actions per
-- cycle on the heaviest pages, was the actual cause of slow route loads and
-- sluggish refreshes dashboard-wide -- not an infinite loop, not Realtime.
--
-- This combines the profile fetch + is_active check + single-device
-- session-token validation + last_seen_at touch into one round-trip,
-- mirroring the proven pattern already used for players by
-- session_heartbeat (20260807000200_rebuild_v2_functions.sql), which safely
-- serves a much higher-frequency workload (bsg_app's 15-second heartbeat
-- across the full player base).
--
-- Deliberately additive, not a replacement: staff_session_touch is left
-- exactly as-is, because src/proxy.ts calls it independently as its own,
-- separate navigation-level single-device gate -- a previously-fixed,
-- deliberate defense-in-depth design (see its own comments), not an
-- oversight. Only requireAuth()'s per-action redundancy is addressed here.
CREATE OR REPLACE FUNCTION public.staff_auth_check(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile public.profiles;
  v_token TEXT;
  v_session_valid BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  -- SECURITY DEFINER bypasses profiles_select's RLS here deliberately, not
  -- incidentally: that policy's qual requires current_is_active(), so a
  -- suspended account's own row is invisible to itself under normal RLS --
  -- this function must still read it to correctly return is_active = false
  -- (so requireAuth() can report "Forbidden: this account is suspended"
  -- rather than a wrong "profile not found"), exactly matching what the
  -- admin-client bypass this replaces was doing.
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('profile_found', false);
  END IF;

  -- Session-token validation only applies to agent/superadmin -- players
  -- never carry this cookie (bsg_app has its own, entirely separate session
  -- mechanism). Mirrors the exact role scoping already in requireAuth().
  IF v_profile.role IN ('agent', 'superadmin') THEN
    IF p_session_token IS NULL THEN
      v_session_valid := false;
    ELSE
      SELECT session_token INTO v_token FROM public.active_sessions WHERE user_id = v_user_id;
      v_session_valid := (v_token IS NOT NULL AND v_token = p_session_token);
      IF v_session_valid THEN
        UPDATE public.active_sessions SET last_seen_at = NOW() WHERE user_id = v_user_id;
      END IF;
    END IF;
  ELSE
    v_session_valid := true; -- not applicable to this role
  END IF;

  RETURN jsonb_build_object(
    'profile_found', true,
    'id', v_profile.id,
    'username', v_profile.username,
    'role', v_profile.role,
    'coin_balance', v_profile.coin_balance,
    'is_active', v_profile.is_active,
    'agent_id', v_profile.agent_id,
    'session_valid', v_session_valid
  );
END;
$function$;

COMMENT ON FUNCTION public.staff_auth_check(text) IS
  'Issue #93: combined profile+session check used by requireAuth() to replace its previous separate admin-client profile select + staff_session_touch call with a single round-trip. staff_session_touch itself is unchanged and still used independently by src/proxy.ts.';
