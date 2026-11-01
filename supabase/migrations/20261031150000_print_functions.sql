-- #############################################################################
-- PRINT TICKETS - PHASE 1, STEP 2: BASE FUNCTIONS
-- Migration: 20261031150000_print_functions.sql
-- Plan: "Print ticket function: phase plan", P1 (approved by Hasan 2026-10-31)
-- #############################################################################
--
-- ADDITIVE. Creates new functions only; no existing function is replaced or
-- changed. None of them takes a bet or moves a coin.
--
--   set_print_enabled(player, on)      superadmin: Print on or off for a player
--   set_print_kill_switch(on)          superadmin: Print on or off for everyone
--   print_mark_ticket(ticket, ...)     the ticket's owner or a superadmin: what
--                                      happened at the printer, and reprints
--   print_active_for_round(player, n)  internal: does Print apply in that round
--   print_allocate_ticket(player, g)   internal: next number and ticket code
--
-- The two internal functions are for the per-game Print functions and can not be
-- called by any client.
--
-- ROUND CLOCK: round_number = floor(epoch / 103), the same for all four games,
-- so one round number can decide when a change applies.
--
-- REFUSALS (SQLSTATE). P0100 and P0135 keep their existing meanings. New, each
-- unused by any migration file (re-check live before applying):
--   P0150 not a player account      P0151 the account has no ID
--   P0152 ticket not found          P0153 bad print status
--   P0154 bad game
-- #############################################################################

BEGIN;

-- =============================================================================
-- print_active_for_round
-- =============================================================================
-- Whether Print applies to a player in a round: `enabled` from effective_round
-- onward, active_before for earlier rounds. The kill switch is separate, because
-- switching it off stops tickets but does not make a print player a board player
-- (Hasan, D6).
CREATE FUNCTION public.print_active_for_round(p_user_id UUID, p_round_number BIGINT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT CASE WHEN p_round_number >= effective_round THEN enabled ELSE active_before END
       FROM public.print_players WHERE user_id = p_user_id),
    false);
$fn$;

-- =============================================================================
-- set_print_enabled
-- =============================================================================
-- Turns Print on or off for a player, from the next round (Hasan, D7). Repeating
-- the current choice changes nothing and logs nothing. Two changes inside one
-- round keep the round's own state, because active_before moves only when an
-- earlier change has already taken effect.
CREATE FUNCTION public.set_print_enabled(p_user_id UUID, p_enabled BOOLEAN)
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
  v_now    BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT / 103;
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
  INSERT INTO public.print_players (user_id, enabled, active_before, effective_round)
  VALUES (p_user_id, false, false, v_now)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.print_players WHERE user_id = p_user_id FOR UPDATE;

  IF v_row.enabled = p_enabled THEN
    RETURN jsonb_build_object('changed', false, 'enabled', p_enabled,
                              'effective_round', v_row.effective_round, 'code', v_code);
  END IF;

  UPDATE public.print_players
     SET enabled         = p_enabled,
         active_before   = CASE WHEN v_now >= v_row.effective_round THEN v_row.enabled ELSE v_row.active_before END,
         effective_round = v_now + 1,
         enabled_at      = CASE WHEN p_enabled THEN NOW() ELSE enabled_at END,
         enabled_by      = CASE WHEN p_enabled THEN v_caller ELSE enabled_by END,
         updated_at      = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO public.audit_log (actor_id, kind, detail)
  VALUES (v_caller, 'account',
    format('Print turned %s for @%s from round %s',
      CASE WHEN p_enabled THEN 'on' ELSE 'off' END, v_target.username, v_now + 1));

  RETURN jsonb_build_object('changed', true, 'enabled', p_enabled,
                            'effective_round', v_now + 1, 'code', v_code);
END;
$fn$;

-- =============================================================================
-- set_print_kill_switch
-- =============================================================================
-- Print on or off for everyone. Applies at once. Print players stay blocked on
-- phones while it is off (Hasan, D6).
CREATE FUNCTION public.set_print_kill_switch(p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_role   TEXT;
  v_active BOOLEAN;
  v_old    BOOLEAN;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS NULL OR v_active IS NOT TRUE OR v_role <> 'superadmin' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SUPERADMIN_ONLY' USING errcode = 'P0135';
  END IF;

  SELECT enabled INTO v_old FROM public.print_settings WHERE id = 'global' FOR UPDATE;
  IF v_old = p_enabled THEN
    RETURN jsonb_build_object('changed', false, 'enabled', p_enabled);
  END IF;

  UPDATE public.print_settings
     SET enabled = p_enabled, updated_by = v_caller, updated_at = NOW()
   WHERE id = 'global';

  INSERT INTO public.audit_log (actor_id, kind, detail)
  VALUES (v_caller, 'system',
    format('Print kill switch: Print turned %s for everyone', CASE WHEN p_enabled THEN 'on' ELSE 'off' END));

  RETURN jsonb_build_object('changed', true, 'enabled', p_enabled);
END;
$fn$;

-- =============================================================================
-- print_allocate_ticket
-- =============================================================================
-- The next ticket number for a player in a game, and its code, such as
-- TC-R01-0001. Four digits, then as many as needed. Internal: a per-game Print
-- function calls it inside its own transaction, so a refused or failed Print
-- rolls the number back and leaves no gap. The counter row lock makes two
-- presses by one player wait for each other.
CREATE FUNCTION public.print_allocate_ticket(p_user_id UUID, p_game TEXT)
RETURNS TABLE (ticket_no BIGINT, ticket_code TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_code   TEXT;
  v_number BIGINT;
BEGIN
  IF p_game IS NULL OR p_game NOT IN ('TC','SW','LC','LS') THEN
    RAISE EXCEPTION 'Bad game' USING errcode = 'P0154';
  END IF;

  SELECT code INTO v_code FROM public.account_codes WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This player has no ID yet' USING errcode = 'P0151';
  END IF;

  INSERT INTO public.print_counters AS c (user_id, game, last_number)
  VALUES (p_user_id, p_game, 1)
  ON CONFLICT (user_id, game) DO UPDATE SET last_number = c.last_number + 1
  RETURNING c.last_number INTO v_number;

  ticket_no   := v_number;
  ticket_code := p_game || '-' || v_code || '-' || lpad(v_number::TEXT, GREATEST(4, length(v_number::TEXT)), '0');
  RETURN NEXT;
END;
$fn$;

-- =============================================================================
-- print_mark_ticket
-- =============================================================================
-- Records what happened at the printer: 'printed', 'not_printed' or 'failed'.
-- 'printed' can only mean handed to Windows. Once printed, a ticket stays
-- printed, so a failed reprint can not hide that it came out once. A reprint adds
-- to reprint_count and always writes an audit row. It never moves a coin.
CREATE FUNCTION public.print_mark_ticket(p_ticket_id UUID, p_status TEXT, p_reprint BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_role   TEXT;
  v_ticket public.print_tickets;
  v_status TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('printed','not_printed','failed') THEN
    RAISE EXCEPTION 'Bad print status' USING errcode = 'P0153';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_caller;
  SELECT * INTO v_ticket FROM public.print_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR (v_ticket.user_id <> v_caller AND v_role IS DISTINCT FROM 'superadmin') THEN
    RAISE EXCEPTION 'Ticket not found' USING errcode = 'P0152';
  END IF;

  v_status := CASE WHEN v_ticket.print_status = 'printed' THEN 'printed' ELSE p_status END;

  UPDATE public.print_tickets
     SET print_status  = v_status,
         reprint_count = reprint_count + CASE WHEN p_reprint THEN 1 ELSE 0 END,
         updated_at    = NOW()
   WHERE id = p_ticket_id;

  IF p_reprint THEN
    INSERT INTO public.audit_log (actor_id, kind, detail)
    VALUES (v_caller, 'system',
      format('Ticket %s reprinted (copy %s): %s', v_ticket.ticket_code, v_ticket.reprint_count + 1, p_status));
  END IF;

  RETURN jsonb_build_object('print_status', v_status,
    'reprint_count', v_ticket.reprint_count + CASE WHEN p_reprint THEN 1 ELSE 0 END);
END;
$fn$;

-- =============================================================================
-- PRIVILEGES
-- =============================================================================
-- Default privileges would grant EXECUTE to anon (Issue #120), so revoke first.
-- Superadmin and owner rules are enforced inside the three client functions; the
-- two internal ones are for other SECURITY DEFINER functions only.
REVOKE ALL ON FUNCTION public.print_active_for_round(UUID, BIGINT)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.print_allocate_ticket(UUID, TEXT)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_print_enabled(UUID, BOOLEAN)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_print_kill_switch(BOOLEAN)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.print_mark_ticket(UUID, TEXT, BOOLEAN)    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.print_active_for_round(UUID, BIGINT)   TO service_role;
GRANT EXECUTE ON FUNCTION public.print_allocate_ticket(UUID, TEXT)      TO service_role;
GRANT EXECUTE ON FUNCTION public.set_print_enabled(UUID, BOOLEAN)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_print_kill_switch(BOOLEAN)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.print_mark_ticket(UUID, TEXT, BOOLEAN) TO authenticated, service_role;

COMMENT ON FUNCTION public.print_active_for_round(UUID, BIGINT) IS
  'Whether Print applies to a player in a round. Internal.';
COMMENT ON FUNCTION public.set_print_enabled(UUID, BOOLEAN) IS
  'Superadmin only: Print on or off for a player, from the next round. A player '
  'with no account ID can not be turned on. Repeating a choice does nothing.';
COMMENT ON FUNCTION public.set_print_kill_switch(BOOLEAN) IS
  'Superadmin only: Print on or off for everyone, at once.';
COMMENT ON FUNCTION public.print_allocate_ticket(UUID, TEXT) IS
  'The next ticket number and code for a player in a game. Internal: called inside '
  'a per-game Print function, so a failed Print leaves no gap.';
COMMENT ON FUNCTION public.print_mark_ticket(UUID, TEXT, BOOLEAN) IS
  'Records the print result and reprints for a ticket, by its owner or a '
  'superadmin. Never moves a coin. Every reprint goes to audit_log.';

COMMIT;
