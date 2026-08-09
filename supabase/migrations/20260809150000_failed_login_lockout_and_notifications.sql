-- #############################################################################
-- BSG v2 — FEATURE: Progressive Failed-Login Lockout + Agent Notifications
-- Migration: 20260809150000_failed_login_lockout_and_notifications.sql
-- #############################################################################
--
-- Adds a server-side, spoof-proof failed-login counter for player accounts.
--
-- attempt_player_login() does the real password check AND the failure
-- counting in one SECURITY DEFINER call -- there is no separate "just report
-- a failure" endpoint, so nobody can inflate another player's count without
-- actually supplying their password. It is granted to `anon` deliberately:
-- the app calls it *before* auth.signInWithPassword, while no session exists
-- yet, so no other role is possible at that point in the flow.
--
-- auto_locked_at distinguishes THIS mechanism's lock from an agent's
-- deliberate setPlayerActiveAction() block (bsg_web_dashboard): only a lock
-- this function set is ever auto-cleared by a password reset. A manual agent
-- block leaves auto_locked_at NULL and is never touched by this feature.
-- #############################################################################

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN failed_login_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  ADD COLUMN auto_locked_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- notifications — one-way alerts to an agent about their own players.
-- No INSERT/UPDATE/DELETE policy for any client role, matching this
-- project's RLS model (20260807000100_rebuild_v2_rls.sql): every write goes
-- through a SECURITY DEFINER function. Even marking a notification read goes
-- through mark_notification_read() below, not a direct client UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL CHECK (kind IN ('security')),
  message    TEXT        NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_agent ON public.notifications (agent_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (
    agent_id = auth.uid()
    OR public.current_role_name() = 'superadmin'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- attempt_player_login — verifies a player's password AND counts failures,
-- atomically. auth.users.encrypted_password is a standard bcrypt hash;
-- extensions.crypt() is the same verification GoTrue itself performs
-- internally. Row-locked on profiles (FOR UPDATE) to avoid two concurrent
-- wrong attempts both reading the same stale count.
-- ─────────────────────────────────────────────────────────────────────────────
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
    -- Not a real account at all -- do NOT report failure here. Returning
    -- success:true is a deliberate pass-through: ApiService.login() proceeds
    -- to its normal signInWithPassword call, which correctly fails with the
    -- standard "Wrong username or password" on its own. This function must
    -- never be the reason a nonexistent username is treated differently from
    -- a real one with a wrong password -- both already look identical via
    -- the existing signInWithPassword path.
    RETURN jsonb_build_object('success', true);
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_auth_row.id FOR UPDATE;

  IF NOT FOUND OR v_profile.role <> 'player' THEN
    -- Staff accounts don't use this counter at all -- this function must
    -- NOT claim invalid_credentials here regardless of whether the password
    -- is actually right or wrong, otherwise a staff member with a CORRECT
    -- password would wrongly see "Wrong username or password" instead of
    -- the existing, correct "This is a staff account, please sign in on the
    -- web dashboard" message (which only fires downstream, after a real
    -- signInWithPassword + session_login role check). Pass through
    -- unconditionally and let the existing flow decide, exactly as it did
    -- before this feature existed.
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
      INSERT INTO public.notifications (agent_id, kind, message)
      VALUES (v_profile.agent_id, 'security',
              format('Player %s was auto-blocked after 5 failed login attempts.', v_profile.username));
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

-- ─────────────────────────────────────────────────────────────────────────────
-- mark_notification_read — the one write a client may make to notifications,
-- scoped to rows the caller actually owns.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  UPDATE public.notifications
     SET read_at = NOW()
   WHERE id = p_id AND agent_id = auth.uid() AND read_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Explicit REVOKE-then-GRANT: this Supabase project auto-grants EXECUTE on
-- every newly created function directly to PUBLIC, anon, AND authenticated
-- (confirmed by inspecting pg_proc/information_schema after a first attempt
-- at this migration -- revoking only FROM PUBLIC was not enough; anon and
-- authenticated must be revoked explicitly too, matching the pattern the
-- 20260807000200 migration already uses for every other function).
REVOKE EXECUTE ON FUNCTION public.attempt_player_login(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(UUID)     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.attempt_player_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID)     TO authenticated;

COMMIT;
