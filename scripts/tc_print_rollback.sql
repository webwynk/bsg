-- Undoes 20261101140000_tc_print_ticket.sql.
--
-- Stops without changing anything if any ticket exists: those are real money
-- records. Then the way back is the kill switch, not this file.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.print_tickets WHERE game = 'TC') THEN
    RAISE EXCEPTION 'Triple Chance tickets exist; use the kill switch instead';
  END IF;
END;
$$;

DROP FUNCTION public.tc_my_tickets(UUID, TIMESTAMPTZ);
DROP FUNCTION public.tc_print_ticket(UUID, JSONB, JSONB, JSONB, UUID);
DROP FUNCTION public.tc_print_state();
DROP FUNCTION public.tc_add_boards(JSONB, JSONB);
DROP FUNCTION public.tc_board_win(JSONB, TEXT, INT, INT);

COMMIT;
