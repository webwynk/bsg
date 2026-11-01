-- #############################################################################
-- PRINT TICKETS - TRIPLE CHANCE: THE PRINT FUNCTION
-- Migration: 20261101140000_tc_print_ticket.sql
-- Plan: docs/print_phase3/PLAN.md
-- #############################################################################
--
-- ADDITIVE. place_bet, draw_round and settle_round are unchanged.
--
--   tc_print_state()                                  may the caller print now
--   tc_print_ticket(round, single, double, triple, press)  buy one printed ticket
--   tc_my_tickets(round, since)                       their tickets and wins
--   tc_board_win(...), tc_add_boards(...)             internal
--
-- Triple Chance has no per-number table rule: its limits live in play_limits and
-- are read by place_bet. So tickets need no table change: the limit is per
-- ticket, read the same way, and tickets add up in the player's bets row with no
-- top limit (Hasan, 2026-11-01).
--
-- settle_round pays the row: stake on the winning key x 9, 90 or 900 x bonus for
-- each board. A ticket's win is the same sum on its own stakes, so the tickets
-- add up to the row. These figures are for showing; they pay nothing.
-- items holds {"single": {...}, "double": {...}, "triple": {...}}.
--
-- P0157 PRINT_OFF, P0158 PRINT_NOT_ACTIVE, as in the other games.
-- #############################################################################

BEGIN;

CREATE FUNCTION public.tc_board_win(p_board JSONB, p_key TEXT, p_rate INT, p_bonus INT)
RETURNS BIGINT
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE WHEN p_key IS NULL THEN 0
              ELSE COALESCE((p_board->>p_key)::BIGINT, 0) * p_rate * p_bonus
         END;
$fn$;

-- One board plus another, number by number.
CREATE FUNCTION public.tc_add_boards(p_a JSONB, p_b JSONB)
RETURNS JSONB
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT COALESCE(jsonb_object_agg(key, total), '{}'::jsonb)
    FROM (
      SELECT key, sum(value::BIGINT) AS total
        FROM (SELECT * FROM jsonb_each_text(COALESCE(p_a, '{}'))
              UNION ALL
              SELECT * FROM jsonb_each_text(COALESCE(p_b, '{}'))) e
       GROUP BY key
    ) s;
$fn$;

-- Whether the Print button may show. The server decides again at each press.
CREATE FUNCTION public.tc_print_state()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_user  UUID := auth.uid();
  v_cycle CONSTANT INT := 103;
  v_start BIGINT := (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) * v_cycle;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  RETURN jsonb_build_object(
    'print_on',    (SELECT enabled FROM public.print_settings WHERE id = 'global'),
    'active_now',  public.print_active_for_round(v_user, to_timestamp(v_start)),
    'active_next', public.print_active_for_round(v_user, to_timestamp(v_start + v_cycle)));
END;
$fn$;

CREATE FUNCTION public.tc_print_ticket(
  p_round_id UUID, p_single_bets JSONB, p_double_bets JSONB, p_triple_bets JSONB, p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_user     UUID := auth.uid();
  v_profile  public.profiles;
  v_round    public.rounds;
  v_ticket   public.print_tickets;
  v_lim      public.play_limits;
  v_on       BOOLEAN;
  v_cutoff   INT;
  v_cycle    CONSTANT INT := 103;
  v_into     INT := (EXTRACT(EPOCH FROM NOW())::BIGINT % v_cycle)::INT;
  v_board    TEXT;
  v_bets     JSONB;
  v_pattern  TEXT;
  v_min      BIGINT;
  v_max      BIGINT;
  v_k        TEXT;
  v_val      JSONB;
  v_v        BIGINT;
  v_stake    BIGINT := 0;
  v_items    JSONB := jsonb_build_object('single', '{}'::jsonb, 'double', '{}'::jsonb, 'triple', '{}'::jsonb);
  v_balance  BIGINT;
  v_no       BIGINT;
  v_code     TEXT;
  v_repeat   BOOLEAN := false;
  v_clash    TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;
  IF v_profile.role <> 'player' THEN
    RAISE EXCEPTION 'Only players may place bets' USING errcode = 'P0114';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'BAD_BET:request' USING errcode = 'P0122';
  END IF;

  -- A press sent again, because its reply was lost, gets the same ticket. This
  -- comes before the round checks: the round may have closed since.
  SELECT * INTO v_ticket FROM public.print_tickets
   WHERE user_id = v_user AND client_request_id = p_request_id;
  IF FOUND THEN
    v_repeat := true;
  ELSE
    SELECT enabled INTO v_on FROM public.print_settings WHERE id = 'global';
    IF v_on IS NOT TRUE THEN
      RAISE EXCEPTION 'PRINT_OFF' USING errcode = 'P0157';
    END IF;

    SELECT bet_cutoff_second INTO v_cutoff FROM public.game_config WHERE id = 'global';
    SELECT * INTO v_lim FROM public.play_limits WHERE id = 'global';

    -- The same closed-round guards, and the same lock, as place_bet.
    SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
    END IF;
    IF v_round.red IS NOT NULL THEN
      RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
    END IF;
    IF v_into >= v_cutoff THEN
      RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
    END IF;
    IF v_round.round_number <> (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) THEN
      RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
    END IF;

    IF NOT public.print_active_for_round(v_user, to_timestamp(v_round.round_number * v_cycle)) THEN
      RAISE EXCEPTION 'PRINT_NOT_ACTIVE' USING errcode = 'P0158';
    END IF;

    -- The same limits as place_bet, for this ticket alone.
    FOREACH v_board IN ARRAY ARRAY['single','double','triple'] LOOP
      IF v_board = 'single' THEN
        v_bets := p_single_bets; v_pattern := '^[0-9]$';     v_min := v_lim.single_min; v_max := v_lim.single_max;
      ELSIF v_board = 'double' THEN
        v_bets := p_double_bets; v_pattern := '^[0-9]{2}$';  v_min := v_lim.double_min; v_max := v_lim.double_max;
      ELSE
        v_bets := p_triple_bets; v_pattern := '^[0-9]{3}$';  v_min := v_lim.triple_min; v_max := v_lim.triple_max;
      END IF;
      v_bets := COALESCE(v_bets, '{}'::jsonb);
      IF jsonb_typeof(v_bets) <> 'object' THEN
        RAISE EXCEPTION 'BAD_BET:not an object' USING errcode = 'P0122';
      END IF;
      FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_bets) LOOP
        IF v_k !~ v_pattern THEN
          RAISE EXCEPTION 'BAD_KEY:%', v_k USING errcode = 'P0122';
        END IF;
        IF jsonb_typeof(v_val) <> 'number' OR v_val::text !~ '^-?[0-9]{1,15}$' THEN
          RAISE EXCEPTION 'BAD_KEY:%', v_k USING errcode = 'P0122';
        END IF;
        v_v := v_val::text::BIGINT;
        IF v_v < v_min THEN RAISE EXCEPTION 'BELOW_MIN'   USING errcode = 'P0123'; END IF;
        IF v_v > v_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode = 'P0124'; END IF;
        v_stake := v_stake + v_v;
      END LOOP;
      v_items := jsonb_set(v_items, ARRAY[v_board], v_bets);
    END LOOP;

    IF v_stake <= 0 THEN
      RAISE EXCEPTION 'EMPTY_BET' USING errcode = 'P0125';
    END IF;

    BEGIN
      -- Rolls back with everything else on a refusal: no gap in the numbers.
      SELECT a.ticket_no, a.ticket_code INTO v_no, v_code
        FROM public.print_allocate_ticket(v_user, 'TC') a;

      v_balance := public.apply_coin_movement(v_user, NULL, 'stake', -v_stake, p_round_id, v_code);

      INSERT INTO public.bets AS b (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
      VALUES (p_round_id, v_user, v_items->'single', v_items->'double', v_items->'triple', v_stake)
      ON CONFLICT (round_id, user_id) DO UPDATE
        SET single_bets = public.tc_add_boards(b.single_bets, EXCLUDED.single_bets),
            double_bets = public.tc_add_boards(b.double_bets, EXCLUDED.double_bets),
            triple_bets = public.tc_add_boards(b.triple_bets, EXCLUDED.triple_bets),
            total_stake = b.total_stake + EXCLUDED.total_stake;

      INSERT INTO public.print_tickets
        (game, ticket_no, ticket_code, user_id, round_id, round_number,
         items, total_stake, client_request_id)
      VALUES
        ('TC', v_no, v_code, v_user, p_round_id, v_round.round_number,
         v_items, v_stake, p_request_id)
      RETURNING * INTO v_ticket;
    EXCEPTION WHEN unique_violation THEN
      -- The same press, sent twice at once: this copy undoes itself and answers
      -- with the ticket the other one made.
      GET STACKED DIAGNOSTICS v_clash = CONSTRAINT_NAME;
      IF v_clash IS DISTINCT FROM 'print_tickets_one_per_press' THEN
        RAISE;
      END IF;
      SELECT * INTO v_ticket FROM public.print_tickets
       WHERE user_id = v_user AND client_request_id = p_request_id;
      v_repeat := true;
    END;
  END IF;

  IF v_ticket.game <> 'TC' THEN
    RAISE EXCEPTION 'BAD_BET:request' USING errcode = 'P0122';
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'repeat',         v_repeat,
    'ticket_id',      v_ticket.id,
    'ticket_code',    v_ticket.ticket_code,
    'ticket_no',      v_ticket.ticket_no,
    'round_id',       v_ticket.round_id,
    'round_number',   v_ticket.round_number,
    'items',          v_ticket.items,
    'total_stake',    v_ticket.total_stake,
    'print_status',   v_ticket.print_status,
    'created_at',     v_ticket.created_at,
    'round_total',    (SELECT total_stake FROM public.bets
                        WHERE round_id = v_ticket.round_id AND user_id = v_user),
    'coin_balance',   (SELECT coin_balance FROM public.profiles WHERE id = v_user),
    'ledger_version', (SELECT ledger_version FROM public.profiles WHERE id = v_user)
  );
END;
$fn$;

-- The caller's tickets, newest first, for one round or since a moment.
CREATE FUNCTION public.tc_my_tickets(p_round_id UUID DEFAULT NULL, p_since TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'created_at')::TIMESTAMPTZ DESC, (row->>'ticket_no')::BIGINT DESC)
      FROM (
        SELECT jsonb_build_object(
                 'ticket_id',        t.id,
                 'ticket_code',      t.ticket_code,
                 'ticket_no',        t.ticket_no,
                 'round_id',         t.round_id,
                 'round_number',     t.round_number,
                 'items',            t.items,
                 'total_stake',      t.total_stake,
                 'print_status',     t.print_status,
                 'reprint_count',    t.reprint_count,
                 'created_at',       t.created_at,
                 'red',              r.red,
                 'green',            r.green,
                 'black',            r.black,
                 'bonus_multiplier', r.bonus_multiplier,
                 'is_drawn',         r.red IS NOT NULL,
                 'single_win',       w.s,
                 'double_win',       w.d,
                 'triple_win',       w.t,
                 'win',              w.s + w.d + w.t
               ) AS row
          FROM public.print_tickets t
          JOIN public.rounds r ON r.id = t.round_id
          CROSS JOIN LATERAL (
            SELECT public.tc_board_win(t.items->'single', r.black::TEXT, 9, r.bonus_multiplier) AS s,
                   public.tc_board_win(t.items->'double', r.green::TEXT || r.black::TEXT, 90, r.bonus_multiplier) AS d,
                   public.tc_board_win(t.items->'triple', r.red::TEXT || r.green::TEXT || r.black::TEXT, 900, r.bonus_multiplier) AS t
          ) w
         WHERE t.user_id = v_user
           AND t.game = 'TC'
           AND (p_round_id IS NULL OR t.round_id = p_round_id)
           AND (p_since IS NULL OR t.created_at >= p_since)
         ORDER BY t.created_at DESC, t.ticket_no DESC
         LIMIT 500
      ) s), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.tc_board_win(JSONB, TEXT, INT, INT)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tc_add_boards(JSONB, JSONB)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tc_print_state()                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tc_print_ticket(UUID, JSONB, JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tc_my_tickets(UUID, TIMESTAMPTZ)                 FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.tc_board_win(JSONB, TEXT, INT, INT)              TO service_role;
GRANT EXECUTE ON FUNCTION public.tc_add_boards(JSONB, JSONB)                      TO service_role;
GRANT EXECUTE ON FUNCTION public.tc_print_state()                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tc_print_ticket(UUID, JSONB, JSONB, JSONB, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tc_my_tickets(UUID, TIMESTAMPTZ)                 TO authenticated, service_role;

COMMENT ON FUNCTION public.tc_print_ticket(UUID, JSONB, JSONB, JSONB, UUID) IS
  'Buys one printed Triple Chance ticket for the caller: charges its stake and adds '
  'it to their bet row. One ticket per press.';
COMMENT ON FUNCTION public.tc_my_tickets(UUID, TIMESTAMPTZ) IS
  'The caller''s Triple Chance tickets with the win of each. For showing only.';

COMMIT;
