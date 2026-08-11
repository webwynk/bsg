-- Add public.notifications.locked_staff_id, mirroring player_id
-- (20260809210000_add_notifications_player_id.sql) exactly, but for staff
-- (agent/superadmin) lockout alerts instead of player lockout alerts.
--
-- ROOT CAUSE (Issue #67, MASTER_AUDIT_AND_REMEDIATION_PLAN.md)
--
-- A player-lockout notification already carries a real, structured link
-- (player_id) back to the account it's about -- deliberately added instead
-- of parsing a name out of the free-text message, specifically so a "Reset
-- Password" button on the alert had a real id to act on. A staff-lockout
-- notification (Issue #60) has no equivalent: notifications.agent_id is
-- always NULL for these rows (broadcast to every superadmin, not one
-- specific recipient) and player_id is obviously NULL too (this alert isn't
-- about a player). There is currently no way to know, in a structured way,
-- which agent/superadmin account a staff-lockout alert refers to -- so the
-- dashboard's Reset Password button, correctly gated on having a real id,
-- can never render for these.
--
-- FIX: same shape as player_id -- nullable, ON DELETE SET NULL so a deleted
-- account's historical alert stays readable, just loses the link.

BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN locked_staff_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.attempt_staff_login(p_username TEXT, p_password TEXT)
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

  IF NOT FOUND OR v_profile.role NOT IN ('agent', 'superadmin') THEN
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
            format('%s %s auto-locked after 5 failed login attempts',
                   initcap(v_profile.role), v_profile.username));

    -- agent_id stays NULL (broadcast to every superadmin) -- only new part
    -- is locked_staff_id, so the alert can now drive a real Reset Password
    -- action instead of just informing.
    INSERT INTO public.notifications (agent_id, kind, message, locked_staff_id)
    VALUES (NULL, 'security',
            format('%s @%s was auto-locked after 5 failed login attempts.',
                   initcap(v_profile.role), v_profile.username),
            v_profile.id);

    RETURN jsonb_build_object('success', false, 'reason', 'account_blocked', 'locked', true);
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'reason', 'invalid_credentials',
    'attempts_remaining', 5 - v_profile.failed_login_attempts
  );
END;
$$;

COMMIT;
