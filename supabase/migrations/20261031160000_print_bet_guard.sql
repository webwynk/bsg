-- #############################################################################
-- PRINT TICKETS - PHASE 2: THE GUARD FOR NORMAL BETS
-- Migration: 20261031160000_print_bet_guard.sql
-- Plan: "Print ticket function: phase plan", P2
-- #############################################################################
--
-- ADDITIVE. Creates one new function; changes nothing existing. It only takes
-- effect once the four place_bet migrations after this one call it. Needs
-- 20261031155000_print_round_clock_fix.sql.
--
-- A normal bet replaces the player's whole board and refunds the difference. On
-- a round row that holds printed tickets, that would refund coins while the
-- tickets stay valid. So a player is refused a normal bet when Print applies to
-- them in that round, or they already hold a ticket for that game in that round
-- (which also covers Print being turned off mid-round). The kill switch plays no
-- part: print players stay blocked while it is off (Hasan, D6).
--
-- p_cycle is the game's own round length, because the round's start is
-- round_number * cycle and Spin2Win's cycle differs from the others.
--
-- P0155 PRINT_REQUIRED is unused by any migration file or live function
-- (checked 2026-10-31).
-- #############################################################################

BEGIN;

-- Internal: called by the four SECURITY DEFINER bet functions. A player who was
-- never turned on has no print_players row and can hold no ticket, so they stop
-- at that one primary key lookup.
CREATE FUNCTION public.print_blocks_normal_bet(p_user_id UUID, p_game TEXT, p_round_number BIGINT, p_cycle INT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.print_players WHERE user_id = p_user_id) THEN
    RETURN false;
  END IF;

  RETURN public.print_active_for_round(p_user_id, to_timestamp(p_round_number * p_cycle))
      OR EXISTS (SELECT 1 FROM public.print_tickets
                  WHERE user_id = p_user_id AND game = p_game AND round_number = p_round_number);
END;
$fn$;

REVOKE ALL ON FUNCTION public.print_blocks_normal_bet(UUID, TEXT, BIGINT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.print_blocks_normal_bet(UUID, TEXT, BIGINT, INT) TO service_role;

COMMENT ON FUNCTION public.print_blocks_normal_bet(UUID, TEXT, BIGINT, INT) IS
  'Whether a normal bet must be refused because the player uses Print in that '
  'round or holds a ticket in it. Internal: called by the bet functions.';

COMMIT;
