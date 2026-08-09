-- #############################################################################
-- BSG v2 — Add notifications.player_id
-- Migration: 20260809210000_add_notifications_player_id.sql
-- #############################################################################
--
-- The alert message is free text ("Player X was auto-blocked...") with no
-- structured way to know which player it's about -- fine for display, not
-- enough to act on (e.g. a "Reset Password" button needs a real id, not a
-- name parsed back out of a sentence). Nullable + ON DELETE SET NULL: a
-- deleted player's historical alert stays readable, just loses the link.
-- #############################################################################

BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN player_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.attempt_player_login(p_username TEXT, p_password TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email    TEXT := lower(p_username) || '@bestsmartgame.com';
  v_auth_row RECORD;
  v_profile  public.profiles;
  v_ok       BOOLEAN;
BEGIN
  SELECT u.id, u.encrypted_password INTO v_auth_row
    FROM auth.users u WHERE u.email = v_email;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_auth_row.id FOR UPDATE;

  IF NOT FOUND OR v_profile.role <> 'player' THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  IF NOT v_profile.is_active THEN
    RETURN jsonb_build_object('success', false, 'reason', 'account_blocked');
  END IF;

  v_ok := (v_auth_row.encrypted_password IS NOT NULL
           AND extensions.crypt(p_password, v_auth_row.encrypted_password) = v_auth_row.encrypted_password);

  IF v_ok THEN
    UPDATE public.profiles SET failed_login_attempts = 0 WHERE id = v_profile.id;
    RETURN jsonb_build_object('success', true);
  END IF;

  UPDATE public.profiles
     SET failed_login_attempts = failed_login_attempts + 1
   WHERE id = v_profile.id
   RETURNING failed_login_attempts INTO v_profile.failed_login_attempts;

  IF v_profile.failed_login_attempts >= 5 THEN
    UPDATE public.profiles
       SET is_active = false, auto_locked_at = NOW()
     WHERE id = v_profile.id;

    DELETE FROM public.active_sessions WHERE user_id = v_profile.id;

    INSERT INTO public.audit_log (actor_id, kind, detail)
    VALUES (v_profile.id, 'security',
            format('Player %s auto-locked after 5 failed login attempts', v_profile.username));

    IF v_profile.agent_id IS NOT NULL THEN
      INSERT INTO public.notifications (agent_id, kind, message, player_id)
      VALUES (v_profile.agent_id, 'security',
              format('Player %s was auto-blocked after 5 failed login attempts.', v_profile.username),
              v_profile.id);
    END IF;

    RETURN jsonb_build_object('success', false, 'reason', 'invalid_credentials', 'locked', true);
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'reason', 'invalid_credentials',
    'attempts_remaining', 5 - v_profile.failed_login_attempts
  );
END;
$$;

COMMIT;
