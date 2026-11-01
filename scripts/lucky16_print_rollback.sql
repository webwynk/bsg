-- Undoes the Lucky 16 Card Print files:
--   20261101110000_lucky16_ticket_stacking.sql
--   20261101111000_lucky16_print_ticket.sql
--   20261101112000_print_mark_ticket_active.sql
--
-- Stops without changing anything if any ticket exists, or any row is above
-- 10,000 on a card: those are real money records and the old rule can not hold
-- them. Then the way back is the kill switch, not this file.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.print_tickets WHERE game = 'LS') THEN
    RAISE EXCEPTION 'Lucky 16 Card tickets exist; use the kill switch instead';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lucky16_bets WHERE a_hearts > 10000 OR a_spades > 10000 OR a_diamonds > 10000 OR a_clubs > 10000 OR j_hearts > 10000 OR j_spades > 10000 OR j_diamonds > 10000 OR j_clubs > 10000 OR q_hearts > 10000 OR q_spades > 10000 OR q_diamonds > 10000 OR q_clubs > 10000 OR k_hearts > 10000 OR k_spades > 10000 OR k_diamonds > 10000 OR k_clubs > 10000) THEN
    RAISE EXCEPTION 'A row is above 10,000 on a card; use the kill switch instead';
  END IF;
END;
$$;

DROP FUNCTION public.lucky16_my_tickets(UUID, TIMESTAMPTZ);
DROP FUNCTION public.lucky16_print_ticket(UUID, JSONB, UUID);
DROP FUNCTION public.lucky16_print_state();
DROP FUNCTION public.lucky16_ticket_win(JSONB, TEXT, TEXT, INT);

CREATE OR REPLACE FUNCTION public.print_mark_ticket(p_ticket_id UUID, p_status TEXT, p_reprint BOOLEAN DEFAULT false)
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

ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_a_hearts_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_a_hearts_check CHECK (a_hearts = 0 OR (a_hearts >= 5 AND a_hearts <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_a_spades_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_a_spades_check CHECK (a_spades = 0 OR (a_spades >= 5 AND a_spades <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_a_diamonds_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_a_diamonds_check CHECK (a_diamonds = 0 OR (a_diamonds >= 5 AND a_diamonds <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_a_clubs_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_a_clubs_check CHECK (a_clubs = 0 OR (a_clubs >= 5 AND a_clubs <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_j_hearts_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_j_hearts_check CHECK (j_hearts = 0 OR (j_hearts >= 5 AND j_hearts <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_j_spades_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_j_spades_check CHECK (j_spades = 0 OR (j_spades >= 5 AND j_spades <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_j_diamonds_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_j_diamonds_check CHECK (j_diamonds = 0 OR (j_diamonds >= 5 AND j_diamonds <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_j_clubs_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_j_clubs_check CHECK (j_clubs = 0 OR (j_clubs >= 5 AND j_clubs <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_q_hearts_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_q_hearts_check CHECK (q_hearts = 0 OR (q_hearts >= 5 AND q_hearts <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_q_spades_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_q_spades_check CHECK (q_spades = 0 OR (q_spades >= 5 AND q_spades <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_q_diamonds_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_q_diamonds_check CHECK (q_diamonds = 0 OR (q_diamonds >= 5 AND q_diamonds <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_q_clubs_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_q_clubs_check CHECK (q_clubs = 0 OR (q_clubs >= 5 AND q_clubs <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_k_hearts_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_k_hearts_check CHECK (k_hearts = 0 OR (k_hearts >= 5 AND k_hearts <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_k_spades_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_k_spades_check CHECK (k_spades = 0 OR (k_spades >= 5 AND k_spades <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_k_diamonds_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_k_diamonds_check CHECK (k_diamonds = 0 OR (k_diamonds >= 5 AND k_diamonds <= 10000));
ALTER TABLE public.lucky16_bets DROP CONSTRAINT lucky16_bets_k_clubs_check;
ALTER TABLE public.lucky16_bets ADD CONSTRAINT lucky16_bets_k_clubs_check CHECK (k_clubs = 0 OR (k_clubs >= 5 AND k_clubs <= 10000));

COMMIT;
