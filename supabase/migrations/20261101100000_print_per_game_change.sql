-- #############################################################################
-- PRINT TICKETS - A PRINT CHANGE APPLIES AT EACH GAME'S OWN NEXT ROUND
-- Migration: 20261101100000_print_per_game_change.sql
-- Plan: "Print ticket function: phase plan", Hasan's change of 2026-11-01
-- #############################################################################
--
-- Replaces the shared change moment of 20261031155000_print_round_clock_fix.sql,
-- which waited for the later of the 103-second and 100-second next rounds, so a
-- game could take one extra round. effective_at is now the moment of the press.
-- print_active_for_round already compares it with each game's own round start,
-- so a round running at the press keeps its old state and every game changes at
-- its own next round.
--
-- active_before describes one earlier state, so it is only right if every round
-- running at a change started after the change before it. No round lasts longer
-- than 103 seconds, so a second change inside 103 seconds is refused with P0156.
--
-- Touches set_print_enabled only. print_active_for_round, the guard and the four
-- bet functions are unchanged. Rollback:
-- scripts/print_per_game_change_rollback.sql
-- #############################################################################

BEGIN;

SET LOCAL lock_timeout = '3s';

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

  -- The row exists before it is locked, so two calls can not both insert it. A
  -- new row has never changed, so its time is long past.
  INSERT INTO public.print_players (user_id, enabled, active_before, effective_at)
  VALUES (p_user_id, false, false, 'epoch')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.print_players WHERE user_id = p_user_id FOR UPDATE;

  IF v_row.enabled = p_enabled THEN
    RETURN jsonb_build_object('changed', false, 'enabled', p_enabled,
                              'effective_at', v_row.effective_at, 'code', v_code);
  END IF;

  IF NOW() < v_row.effective_at + INTERVAL '103 seconds' THEN
    RAISE EXCEPTION 'PRINT_CHANGE_TOO_SOON' USING errcode = 'P0156';
  END IF;

  UPDATE public.print_players
     SET enabled       = p_enabled,
         active_before = v_row.enabled,
         effective_at  = NOW(),
         enabled_at    = CASE WHEN p_enabled THEN NOW() ELSE enabled_at END,
         enabled_by    = CASE WHEN p_enabled THEN v_caller ELSE enabled_by END,
         updated_at    = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO public.audit_log (actor_id, kind, detail)
  VALUES (v_caller, 'account',
    format('Print turned %s for @%s from each game''s next round',
      CASE WHEN p_enabled THEN 'on' ELSE 'off' END, v_target.username));

  RETURN jsonb_build_object('changed', true, 'enabled', p_enabled,
                            'effective_at', NOW(), 'code', v_code);
END;
$fn$;

COMMIT;
