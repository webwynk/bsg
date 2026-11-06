-- #############################################################################
-- PRINT TICKETS - DASHBOARD: STAFF READ OF A PLAYER'S TICKETS
-- Migration: 20261102100000_print_staff_tickets.sql
-- Plan: docs/print_dashboard/PLAN.md, Phase 3
-- #############################################################################
--
-- ADDITIVE AND READ ONLY.
--
--   print_staff_tickets(player, game, round numbers)  those rounds' tickets, with wins
--
-- The *_my_tickets functions read auth.uid(), so they only serve the player. This
-- gives the dashboard the same tickets for a player it names. Each win comes from
-- the same ticket win functions the Windows app sees, so the dashboard keeps no
-- copy of a payout formula.
--
-- Only service_role can run it, and it does not check who is asking. The
-- dashboard must run requireAuth() and, for an agent, assertOwnership() first.
-- anon and authenticated can not call it, so a signed-in agent or player can not
-- reach it directly and name another player.
--
-- SECURITY INVOKER: it reads with service_role's own rights and needs no others.

BEGIN;

CREATE FUNCTION public.print_staff_tickets(p_user_id UUID, p_game TEXT, p_round_numbers BIGINT[])
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_game IS NULL OR p_game NOT IN ('TC','SW','LC','LS') THEN
    RAISE EXCEPTION 'Unknown game' USING errcode = '22023';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'round_number')::BIGINT DESC, (row->>'ticket_no')::BIGINT)
      FROM (
        SELECT jsonb_build_object(
                 'ticket_id',    t.id,
                 'ticket_code',  t.ticket_code,
                 'ticket_no',    t.ticket_no,
                 'round_number', t.round_number,
                 'items',        t.items,
                 'total_stake',  t.total_stake,
                 'created_at',   t.created_at,
                 'is_drawn',     w.is_drawn,
                 'win',          w.win
               ) AS row
          FROM public.print_tickets t
          CROSS JOIN LATERAL (
            SELECT r.winning_rank IS NOT NULL AS is_drawn,
                   public.lucky16_ticket_win(t.items, r.winning_rank, r.winning_suit, r.bonus_multiplier) AS win
              FROM public.lucky16_rounds r
             WHERE r.id = t.lucky16_round_id
            UNION ALL
            SELECT r.winning_rank IS NOT NULL,
                   public.lucky_card_ticket_win(t.items, r.winning_rank, r.winning_suit, r.bonus_multiplier)
              FROM public.lucky_card_rounds r
             WHERE r.id = t.lucky_card_round_id
            UNION ALL
            SELECT r.winning_number IS NOT NULL,
                   public.spin2win_ticket_win(t.items, r.winning_number, r.bonus_multiplier)
              FROM public.spin2win_rounds r
             WHERE r.id = t.spin2win_round_id
            UNION ALL
            SELECT r.red IS NOT NULL,
                   public.tc_board_win(t.items->'single', r.black::TEXT, 9, r.bonus_multiplier)
                 + public.tc_board_win(t.items->'double', r.green::TEXT || r.black::TEXT, 90, r.bonus_multiplier)
                 + public.tc_board_win(t.items->'triple', r.red::TEXT || r.green::TEXT || r.black::TEXT, 900, r.bonus_multiplier)
              FROM public.rounds r
             WHERE r.id = t.round_id
          ) w
         WHERE t.user_id = p_user_id
           AND t.game = p_game
           AND t.round_number = ANY (p_round_numbers)
         ORDER BY t.round_number DESC, t.ticket_no
         LIMIT 2000
      ) s), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.print_staff_tickets(UUID, TEXT, BIGINT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.print_staff_tickets(UUID, TEXT, BIGINT[]) TO service_role;

COMMENT ON FUNCTION public.print_staff_tickets(UUID, TEXT, BIGINT[]) IS
  'One player''s tickets in the given rounds of one game, with the win of each. For '
  'showing only. service_role only: the dashboard checks the caller first.';

COMMIT;
