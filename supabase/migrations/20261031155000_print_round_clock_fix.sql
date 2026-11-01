-- #############################################################################
-- PRINT TICKETS - PHASE 1 CORRECTION: ROUNDS ARE NOT ONE CLOCK
-- Migration: 20261031155000_print_round_clock_fix.sql
-- Plan: "Print ticket function: phase plan", P1
-- #############################################################################
--
-- 20261031150000_print_functions.sql said the four games share one round
-- number. They do not: Spin2Win runs a 100-second cycle, the others 103, so a
-- Spin2Win round number is a different count. A change stored as a round number
-- would have applied at once on Spin2Win, not from the next round.
--
-- A change now applies from a moment in time, and each game compares that with
-- the start of its own round:
--   * effective_at is the next round start of whichever clock comes later, so no
--     game is cut off part-way through a round;
--   * a round starting at or after effective_at uses `enabled`;
--   * an earlier round uses active_before.
--
-- Touches print objects only; nothing else exists that uses them, and
-- print_players must be empty (the file stops if it is not). No game function
-- is changed.
-- #############################################################################

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.print_players) THEN
    RAISE EXCEPTION 'print_players is not empty; this correction assumes it is';
  END IF;
END;
$$;

ALTER TABLE public.print_players DROP COLUMN effective_round;
ALTER TABLE public.print_players ADD COLUMN effective_at TIMESTAMPTZ NOT NULL;

COMMENT ON TABLE public.print_players IS
  'Who uses Print. A change applies to rounds starting at or after effective_at; '
  'see print_active_for_round.';

DROP FUNCTION public.print_active_for_round(UUID, BIGINT);

-- Whether Print applies to a player in a round that starts at p_round_start. The
-- kill switch is separate (Hasan, D6). Internal.
CREATE FUNCTION public.print_active_for_round(p_user_id UUID, p_round_start TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT CASE WHEN p_round_start >= effective_at THEN enabled ELSE active_before END
       FROM public.print_players WHERE user_id = p_user_id),
    false);
$fn$;

REVOKE ALL ON FUNCTION public.print_active_for_round(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.print_active_for_round(UUID, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.print_active_for_round(UUID, TIMESTAMPTZ) IS
  'Whether Print applies to a player in a round starting at that moment. Internal.';

-- Same function and rules as before, with effective_at in place of a round
-- number. Two changes before effective_at keep the running round's own state,
-- because active_before moves only once an earlier change has taken effect.
CREATE OR REPLACE FUNCTION public.set_print_enabled(p_user_id UUID, p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_role   TEXT;
  v_active BOOLEAN;
  v_target public.profiles;
  v_code   TEXT;
  v_row    public.print_players;
  v_epoch  BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  -- The next round start of both clocks: 103 seconds, and Spin2Win's 100.
  v_from   TIMESTAMPTZ := to_timestamp(GREATEST((v_epoch / 103 + 1) * 103, (v_epoch / 100 + 1) * 100));
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS NULL OR v_active IS NOT TRUE OR v_role <> 'superadmin' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SUPERADMIN_ONLY' USING errcode = 'P0135';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND OR v_target.role <> 'player' THEN
    RAISE EXCEPTION 'Not a player account' USING errcode = 'P0150';
  END IF;

  SELECT code INTO v_code FROM public.account_codes WHERE user_id = p_user_id;
  IF NOT FOUND AND p_enabled THEN
    RAISE EXCEPTION 'This player has no ID yet' USING errcode = 'P0151';
  END IF;

  -- The row exists before it is locked, so two calls can not both insert it.
  INSERT INTO public.print_players (user_id, enabled, active_before, effective_at)
  VALUES (p_user_id, false, false, NOW())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.print_players WHERE user_id = p_user_id FOR UPDATE;

  IF v_row.enabled = p_enabled THEN
    RETURN jsonb_build_object('changed', false, 'enabled', p_enabled,
                              'effective_at', v_row.effective_at, 'code', v_code);
  END IF;

  UPDATE public.print_players
     SET enabled       = p_enabled,
         active_before = CASE WHEN NOW() >= v_row.effective_at THEN v_row.enabled ELSE v_row.active_before END,
         effective_at  = v_from,
         enabled_at    = CASE WHEN p_enabled THEN NOW() ELSE enabled_at END,
         enabled_by    = CASE WHEN p_enabled THEN v_caller ELSE enabled_by END,
         updated_at    = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO public.audit_log (actor_id, kind, detail)
  VALUES (v_caller, 'account',
    format('Print turned %s for @%s from %s',
      CASE WHEN p_enabled THEN 'on' ELSE 'off' END, v_target.username, v_from));

  RETURN jsonb_build_object('changed', true, 'enabled', p_enabled,
                            'effective_at', v_from, 'code', v_code);
END;
$fn$;

COMMIT;
