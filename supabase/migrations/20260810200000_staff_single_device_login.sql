-- #############################################################################
-- BSG v2 — FEATURE: Single-Device Login for Agent/Superadmin (Dashboard)
-- Migration: 20260810200000_staff_single_device_login.sql
-- #############################################################################
--
-- Deliberately NOT the same precedence as the player version (session_login,
-- 30s grace, silent reclaim once stale). User-specified behavior: a second
-- login is refused outright while the first is fresh, with NO convenient
-- auto-swap -- the only intended way in is an explicit logout on the first
-- device. staff_session_grace_sec (6h default) exists purely as a crash
-- safety net, not a routine part of the flow, which is why it's a separate,
-- much longer value from the player grace period rather than reusing it.
--
-- No heartbeat RPC (unlike session_heartbeat): the dashboard has no
-- long-running background process the way the mobile app does. Instead,
-- staff_session_touch is called from requireAuth on every ordinary dashboard
-- action -- already-existing traffic, not a new poll loop -- which both
-- proves liveness (refreshing last_seen_at) and catches a superseded session
-- the next time it tries to do anything.
--
-- The token compared here is NOT the Supabase access token (that rotates
-- silently in the background over a session this long, which would cause
-- random false logouts) -- it's an application-minted random value the
-- dashboard stores in its own first-party cookie, orthogonal to Supabase's
-- own session/cookie management.
-- #############################################################################

BEGIN;

ALTER TABLE public.game_config
  ADD COLUMN staff_session_grace_sec INT NOT NULL DEFAULT 21600
    CHECK (staff_session_grace_sec BETWEEN 60 AND 86400);

-- Claims (or refuses) the single-device seat for a staff login. Same
-- claim-or-refuse shape as session_login, deliberately kept as a separate
-- function rather than parameterizing session_login itself: the two have
-- different role scope, different grace-period source, and mixing player
-- and staff precedence into one shared function risks a future change to
-- one silently affecting the other.
CREATE OR REPLACE FUNCTION public.staff_session_login(p_session_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_profile  public.profiles;
  v_existing public.active_sessions;
  v_grace    INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING errcode = 'P0111';
  END IF;
  IF v_profile.role NOT IN ('agent', 'superadmin') THEN
    RAISE EXCEPTION 'Staff accounts only' USING errcode = 'P0140';
  END IF;
  IF NOT v_profile.is_active THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'account_blocked');
  END IF;

  SELECT staff_session_grace_sec INTO v_grace FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_existing FROM public.active_sessions
    WHERE user_id = v_user_id FOR UPDATE;

  IF FOUND
     AND v_existing.session_token <> p_session_token
     AND v_existing.last_seen_at > NOW() - make_interval(secs => v_grace)
  THEN
    -- Another device's session is still within the safety-net window.
    -- Refused outright -- no takeover, no queueing.
    RETURN jsonb_build_object(
      'allowed', false,
      'reason',  'session_active_elsewhere'
    );
  END IF;

  INSERT INTO public.active_sessions (user_id, session_token, last_seen_at)
  VALUES (v_user_id, p_session_token, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET session_token = EXCLUDED.session_token,
        last_seen_at  = NOW();

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- Called from requireAuth on every ordinary dashboard action. Deliberately
-- minimal -- no balance/profile fields the way session_heartbeat returns for
-- players, since nothing in the dashboard needs them from this call and this
-- runs on nearly every request.
CREATE OR REPLACE FUNCTION public.staff_session_touch(p_session_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_token   TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT session_token INTO v_token FROM public.active_sessions WHERE user_id = v_user_id;

  IF v_token IS NULL OR v_token <> p_session_token THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  UPDATE public.active_sessions SET last_seen_at = NOW() WHERE user_id = v_user_id;

  RETURN jsonb_build_object('valid', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.staff_session_login(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_session_touch(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_session_login(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_session_touch(TEXT) TO authenticated;

COMMIT;
