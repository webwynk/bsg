-- Undoes 20261101120000_spin2win_ticket_stacking.sql and
-- 20261101121000_spin2win_print_ticket.sql.
--
-- Stops without changing anything if any ticket exists, or any row is above
-- 10,000 on a number: those are real money records and the old rule can not hold
-- them. Then the way back is the kill switch, not this file.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.print_tickets WHERE game = 'SW') THEN
    RAISE EXCEPTION 'Spin2Win tickets exist; use the kill switch instead';
  END IF;
  IF EXISTS (SELECT 1 FROM public.spin2win_bets WHERE n0 > 10000 OR n1 > 10000 OR n2 > 10000 OR n3 > 10000 OR n4 > 10000 OR n5 > 10000 OR n6 > 10000 OR n7 > 10000 OR n8 > 10000 OR n9 > 10000) THEN
    RAISE EXCEPTION 'A row is above 10,000 on a number; use the kill switch instead';
  END IF;
END;
$$;

DROP FUNCTION public.spin2win_my_tickets(UUID, TIMESTAMPTZ);
DROP FUNCTION public.spin2win_print_ticket(UUID, JSONB, UUID);
DROP FUNCTION public.spin2win_print_state();
DROP FUNCTION public.spin2win_ticket_win(JSONB, INT, INT);

ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n0_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n0_check CHECK (n0 = 0 OR (n0 >= 5 AND n0 <= 10000));
ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n1_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n1_check CHECK (n1 = 0 OR (n1 >= 5 AND n1 <= 10000));
ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n2_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n2_check CHECK (n2 = 0 OR (n2 >= 5 AND n2 <= 10000));
ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n3_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n3_check CHECK (n3 = 0 OR (n3 >= 5 AND n3 <= 10000));
ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n4_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n4_check CHECK (n4 = 0 OR (n4 >= 5 AND n4 <= 10000));
ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n5_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n5_check CHECK (n5 = 0 OR (n5 >= 5 AND n5 <= 10000));
ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n6_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n6_check CHECK (n6 = 0 OR (n6 >= 5 AND n6 <= 10000));
ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n7_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n7_check CHECK (n7 = 0 OR (n7 >= 5 AND n7 <= 10000));
ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n8_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n8_check CHECK (n8 = 0 OR (n8 >= 5 AND n8 <= 10000));
ALTER TABLE public.spin2win_bets DROP CONSTRAINT spin2win_bets_n9_check;
ALTER TABLE public.spin2win_bets ADD CONSTRAINT spin2win_bets_n9_check CHECK (n9 = 0 OR (n9 >= 5 AND n9 <= 10000));

COMMIT;
