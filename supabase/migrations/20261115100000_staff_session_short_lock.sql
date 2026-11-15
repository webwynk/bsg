-- #############################################################################
-- BSG v2 — Staff single-login: short lock + "minutes left" + grant tidy-up
-- Migration: 20261115100000_staff_session_short_lock.sql
-- Plan: option A, thread "Block second login on admin/agent accounts" (2026-11-15)
-- #############################################################################
--
-- Rule kept (Hasan, 2026-11-15): a second agent/superadmin login is REFUSED
-- while the first one is active; the first session is never disturbed.
--
-- Problem fixed: "active" used to mean "seen in the last 6 hours"
-- (staff_session_grace_sec = 21600), and the dashboard only refreshed
-- last_seen_at on a click/page load. A closed tab therefore kept the account
-- locked for up to 6 hours (superadmin had to be cleared by hand on
-- 2026-11-02 and 2026-11-07).
--
-- The dashboard now sends a background keep-alive every 30 s from every open
-- staff tab (src/components/staff-session-heartbeat.tsx ->
-- /api/staff-heartbeat -> requireAuth -> staff_auth_check, which refreshes
-- last_seen_at). That makes a short window safe:
--
--   1. staff_session_grace_sec 21600 -> 180 (3 minutes = 6 missed beats;
--      browsers slow hidden-tab timers to about once a minute, still inside).
--   2. staff_session_login also returns seconds_until_free when it refuses,
--      so the login page can say "try again in about N minutes".
--      Same refusal rule as before otherwise; no takeover.
--   3. staff_auth_check: REVOKE from PUBLIC/anon (20260825170000 never revoked
--      the default PUBLIC grant; found by the 2026-11-15 read-only check).
--      Harmless before (it raises when auth.uid() is null) — tidy-up only.
--
-- DEPLOY ORDER: dashboard code (with the keep-alive) FIRST, then this file.
-- Applying this before the new code is live would let an idle-but-open tab
-- lose its seat after 3 minutes.
--
-- Rollback: scripts/staff_session_short_lock_rollback.sql
-- #############################################################################

BEGIN;

SET LOCAL lock_timeout = '3s';

UPDATE public.game_config SET staff_session_grace_sec = 180 WHERE id = 'global';
ALTER TABLE public.game_config ALTER COLUMN staff_session_grace_sec SET DEFAULT 180;

-- Claims (or refuses) the single seat for an agent/superadmin login.
-- Refuses with reason 'session_active_elsewhere' while another token's
-- last_seen_at is younger than staff_session_grace_sec, and reports how many
-- seconds remain until that seat frees itself if its keep-alive has stopped.
-- An open tab keeps refreshing last_seen_at, so the seat never frees while
-- that tab stays open and signed in.
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
    RETURN jsonb_build_object(
      'allowed', false,
      'reason',  'session_active_elsewhere',
      'seconds_until_free',
        GREATEST(0, v_grace - EXTRACT(EPOCH FROM (NOW() - v_existing.last_seen_at))::INT)
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

REVOKE EXECUTE ON FUNCTION public.staff_session_login(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_session_login(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.staff_auth_check(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_auth_check(TEXT) TO authenticated;

COMMIT;
