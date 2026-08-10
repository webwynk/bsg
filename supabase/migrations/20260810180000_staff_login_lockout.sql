-- #############################################################################
-- BSG v2 — FEATURE: Progressive Failed-Login Lockout for Staff (Agent/Superadmin)
-- Migration: 20260810180000_staff_login_lockout.sql
-- #############################################################################
--
-- Mirrors attempt_player_login (20260809150000) closely, adapted for staff:
--   - Same columns reused: profiles.failed_login_attempts/auto_locked_at were
--     never player-specific in the schema, just previously only managed by
--     attempt_player_login.
--   - Same "does the real password check itself" reasoning: a Server Action
--     (not a mobile client) calls this, so it isn't spoofable the way a
--     client-reported failure would be -- but doing the real bcrypt check
--     here anyway keeps one consistent trust model for both login flows
--     rather than inventing a second one.
--   - Same early-exit for an already-blocked account (is_active = false
--     covers BOTH a deliberate agent/superadmin block AND a prior auto-lock,
--     since auto-locking also sets is_active = false) -- returns
--     'account_blocked' without even checking the password, exactly like the
--     player version, so a blocked account's failed attempts are never
--     counted (pointless either way) and its wrong password never leaks
--     timing information.
--   - Deliberately ONE reason code ('account_blocked') for both a manual
--     block and an auto-lock, matching the player flow's own design: the
--     LOGIN-facing message doesn't need to distinguish why, only that they're
--     blocked and who to contact. The distinction (auto vs manual) is purely
--     an internal/admin-facing concern, handled by auto_locked_at and the
--     status badge -- not by a different login error message.
--
-- notifications.agent_id is loosened to nullable here: a staff lockout has no
-- single "agent" recipient the way a player lockout does (the agent IS the
-- one locked out) -- it's meant for the superadmin(s). NULL agent_id means
-- "broadcast", and getAgentNotificationsAction already omits its agent_id
-- filter for a superadmin caller (confirmed by reading the current code, not
-- assumed), so no dashboard code change is needed to make a superadmin see
-- these -- only a UI entry point into the existing page, added separately.
-- #############################################################################

BEGIN;

ALTER TABLE public.notifications ALTER COLUMN agent_id DROP NOT NULL;

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
    -- Not a real account -- pass through so the real signInWithPassword call
    -- fails on its own with the standard "Invalid username or password",
    -- exactly like the player version's identical reasoning.
    RETURN jsonb_build_object('success', true);
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_auth_row.id FOR UPDATE;

  IF NOT FOUND OR v_profile.role NOT IN ('agent', 'superadmin') THEN
    -- Player accounts (or anything unexpected) don't use this counter --
    -- pass through unconditionally, same reasoning as the player version's
    -- symmetric staff-role pass-through.
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

    -- agent_id NULL -- broadcast to every superadmin, not a specific agent
    -- (there's no meaningful "recipient agent" for a staff account's own
    -- lockout, unlike a player's, where the recipient is that player's agent).
    INSERT INTO public.notifications (agent_id, kind, message)
    VALUES (NULL, 'security',
            format('%s @%s was auto-locked after 5 failed login attempts.',
                   initcap(v_profile.role), v_profile.username));

    RETURN jsonb_build_object('success', false, 'reason', 'account_blocked', 'locked', true);
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'reason', 'invalid_credentials',
    'attempts_remaining', 5 - v_profile.failed_login_attempts
  );
END;
$$;

-- Same explicit REVOKE-then-GRANT this project already needs for every new
-- function -- Postgres auto-grants EXECUTE to PUBLIC/anon/authenticated on
-- creation, confirmed the hard way earlier this session (Issue #59's
-- overload fix). Granted to anon for the same reason as attempt_player_login:
-- called before any session exists.
REVOKE EXECUTE ON FUNCTION public.attempt_staff_login(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_staff_login(TEXT, TEXT) TO anon, authenticated;

COMMIT;
