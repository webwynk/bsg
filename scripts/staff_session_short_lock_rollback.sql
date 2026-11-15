-- Rollback for supabase/migrations/20261115100000_staff_session_short_lock.sql
-- Restores the 6-hour staff lock and the previous staff_session_login body
-- (20260810200000_staff_single_device_login.sql, verified identical to live on
-- 2026-11-15). staff_auth_check's PUBLIC/anon grant is put back as it was.

BEGIN;

SET LOCAL lock_timeout = '3s';

UPDATE public.game_config SET staff_session_grace_sec = 21600 WHERE id = 'global';
ALTER TABLE public.game_config ALTER COLUMN staff_session_grace_sec SET DEFAULT 21600;

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

REVOKE EXECUTE ON FUNCTION public.staff_session_login(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_session_login(TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.staff_auth_check(TEXT) TO PUBLIC, anon;

COMMIT;
