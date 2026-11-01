-- #############################################################################
-- PRINT TICKETS - A BLOCKED ACCOUNT CAN NOT MARK A TICKET
-- Migration: 20261101112000_print_mark_ticket_active.sql
-- Plan: docs/print_phase3/PLAN.md
-- #############################################################################
--
-- Audit finding D6: print_mark_ticket did not check that the account is active.
-- Same function otherwise. It never moved a coin.
-- #############################################################################

BEGIN;

CREATE OR REPLACE FUNCTION public.print_mark_ticket(p_ticket_id UUID, p_status TEXT, p_reprint BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_role   TEXT;
  v_active BOOLEAN;
  v_ticket public.print_tickets;
  v_status TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('printed','not_printed','failed') THEN
    RAISE EXCEPTION 'Bad print status' USING errcode = 'P0153';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;
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

COMMIT;
