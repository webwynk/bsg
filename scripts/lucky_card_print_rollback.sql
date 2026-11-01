-- Undoes 20261101130000_lucky_card_ticket_stacking.sql and
-- 20261101131000_lucky_card_print_ticket.sql.
--
-- Stops without changing anything if any ticket exists, or any row is above
-- 50,000 on a card: those are real money records and the old rule can not hold
-- them. Then the way back is the kill switch, not this file.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.print_tickets WHERE game = 'LC') THEN
    RAISE EXCEPTION 'Lucky Card tickets exist; use the kill switch instead';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lucky_card_bets WHERE j_hearts > 50000 OR j_spades > 50000 OR j_diamonds > 50000 OR j_clubs > 50000 OR q_hearts > 50000 OR q_spades > 50000 OR q_diamonds > 50000 OR q_clubs > 50000 OR k_hearts > 50000 OR k_spades > 50000 OR k_diamonds > 50000 OR k_clubs > 50000) THEN
    RAISE EXCEPTION 'A row is above 50,000 on a card; use the kill switch instead';
  END IF;
END;
$$;

DROP FUNCTION public.lucky_card_my_tickets(UUID, TIMESTAMPTZ);
DROP FUNCTION public.lucky_card_print_ticket(UUID, JSONB, UUID);
DROP FUNCTION public.lucky_card_print_state();
DROP FUNCTION public.lucky_card_ticket_win(JSONB, TEXT, TEXT, INT);

ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_j_hearts_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_j_hearts_check CHECK (j_hearts = 0 OR (j_hearts >= 5 AND j_hearts <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_j_spades_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_j_spades_check CHECK (j_spades = 0 OR (j_spades >= 5 AND j_spades <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_j_diamonds_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_j_diamonds_check CHECK (j_diamonds = 0 OR (j_diamonds >= 5 AND j_diamonds <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_j_clubs_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_j_clubs_check CHECK (j_clubs = 0 OR (j_clubs >= 5 AND j_clubs <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_q_hearts_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_q_hearts_check CHECK (q_hearts = 0 OR (q_hearts >= 5 AND q_hearts <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_q_spades_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_q_spades_check CHECK (q_spades = 0 OR (q_spades >= 5 AND q_spades <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_q_diamonds_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_q_diamonds_check CHECK (q_diamonds = 0 OR (q_diamonds >= 5 AND q_diamonds <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_q_clubs_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_q_clubs_check CHECK (q_clubs = 0 OR (q_clubs >= 5 AND q_clubs <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_k_hearts_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_k_hearts_check CHECK (k_hearts = 0 OR (k_hearts >= 5 AND k_hearts <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_k_spades_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_k_spades_check CHECK (k_spades = 0 OR (k_spades >= 5 AND k_spades <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_k_diamonds_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_k_diamonds_check CHECK (k_diamonds = 0 OR (k_diamonds >= 5 AND k_diamonds <= 50000));
ALTER TABLE public.lucky_card_bets DROP CONSTRAINT lucky_card_bets_k_clubs_check;
ALTER TABLE public.lucky_card_bets ADD CONSTRAINT lucky_card_bets_k_clubs_check CHECK (k_clubs = 0 OR (k_clubs >= 5 AND k_clubs <= 50000));

COMMIT;
