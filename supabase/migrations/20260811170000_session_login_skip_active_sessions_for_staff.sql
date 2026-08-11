-- Issue #12 (MASTER_AUDIT_AND_REMEDIATION_PLAN.md) -- Fix 2 of 2, database-side
-- defense-in-depth. Fix 1 (app-side, bsg_app's ApiService.login) closes the
-- immediate bug; this closes the bug CLASS at its source.
--
-- ROOT CAUSE (re-audited, more serious than originally documented)
--
-- session_login claims a public.active_sessions row for ANY successfully-
-- authenticated caller, regardless of role -- the role check only happens
-- afterward, in bsg_app's Dart code, after the claim has already succeeded.
-- If a staff (agent/superadmin) account mistakenly logs into the mobile game
-- app, this RPC claims a slot for them before the app rejects them for the
-- wrong role.
--
-- The master plan originally described this as narrow and self-limiting
-- ("can only affect that same staff account's own next mobile app login").
-- That was true when written, but stopped being true on 2026-08-10: Issue
-- #61 (staff_session_login, the web dashboard's own single-device
-- enforcement) reuses this exact same active_sessions table. Confirmed live:
-- staff_session_grace_sec is 21600 (6 hours). So an orphaned claim from one
-- accidental mobile-app login attempt can lock that same staff member out of
-- the WEB DASHBOARD -- refused with "already logged in on another device" --
-- for up to 6 hours, even though nothing is actually active anywhere.
--
-- FIX
--
-- session_login now returns immediately for a non-player role, with the
-- exact same success shape a normal player claim already returns, before
-- ever touching active_sessions. bsg_app's existing role != 'player' check
-- (which runs on this same response, after 'allowed') is completely
-- unaffected -- it still performs the actual rejection and messaging,
-- unchanged. staff_session_login needs no change either: with this fix, a
-- staff account's mobile-app login attempt never creates a row for it to
-- trip over in the first place.

BEGIN;

CREATE OR REPLACE FUNCTION public.session_login(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID := auth.uid();
  v_profile   public.profiles;
  v_existing  public.active_sessions;
  v_grace     INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING errcode = 'P0111';
  END IF;
  IF NOT v_profile.is_active THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'account_blocked');
  END IF;

  -- Issue #12: a staff (agent/superadmin) caller never claims a slot in
  -- active_sessions here at all -- that table is also used by
  -- staff_session_login (the dashboard's own single-device mechanism), so a
  -- claim made here for a staff account risks orphaning a row that would
  -- then block that same staff member's own dashboard login for up to
  -- staff_session_grace_sec (6h), until it naturally expires. Returns the
  -- identical success shape a normal player claim returns -- bsg_app's own
  -- role != 'player' check (unchanged) still runs against this response and
  -- performs the actual rejection.
  IF v_profile.role <> 'player' THEN
    RETURN jsonb_build_object(
      'allowed',        true,
      'user_id',        v_profile.id,
      'username',       v_profile.username,
      'role',           v_profile.role,
      'coin_balance',   v_profile.coin_balance,
      'ledger_version', v_profile.ledger_version
    );
  END IF;

  SELECT session_grace_sec INTO v_grace FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_existing FROM public.active_sessions
    WHERE user_id = v_user_id FOR UPDATE;

  IF FOUND
     AND v_existing.session_token <> p_session_token
     AND v_existing.last_seen_at > NOW() - make_interval(secs => v_grace)
  THEN
    -- Another device is still heartbeating. Refuse, do not displace.
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

  RETURN jsonb_build_object(
    'allowed',        true,
    'user_id',        v_profile.id,
    'username',       v_profile.username,
    'role',           v_profile.role,
    'coin_balance',   v_profile.coin_balance,
    'ledger_version', v_profile.ledger_version
  );
END;
$function$;

COMMIT;
