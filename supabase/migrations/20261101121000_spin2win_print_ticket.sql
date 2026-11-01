-- #############################################################################
-- PRINT TICKETS - SPIN2WIN: THE PRINT FUNCTION
-- Migration: 20261101121000_spin2win_print_ticket.sql
-- Plan: docs/print_phase3/PLAN.md
-- #############################################################################
--
-- ADDITIVE. Needs 20261101120000_spin2win_ticket_stacking.sql.
--
--   spin2win_print_state()                     the caller: may they print now
--   spin2win_print_ticket(round, bets, press)  the caller: buy one printed ticket
--   spin2win_my_tickets(round, since)          the caller: their tickets and wins
--   spin2win_ticket_win(...)                   internal: one ticket's win
--
-- A ticket adds into the player's spin2win_bets row and never replaces it, so
-- the draw, settlement and the staff totals read printed stakes exactly as they
-- read a normal bet. spin2win_settle_round pays the row: winning number's stake x
-- 9 x bonus. A ticket's win is its own stake on that number x 9 x bonus, so the
-- tickets add up to the row. spin2win_ticket_win is for showing; it pays nothing.
--
-- P0157 PRINT_OFF: the kill switch is off.
-- P0158 PRINT_NOT_ACTIVE: Print does not apply to this player in this round.
-- #############################################################################

BEGIN;

CREATE FUNCTION public.spin2win_ticket_win(p_items JSONB, p_number INT, p_bonus INT)
RETURNS BIGINT
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE WHEN p_number IS NULL THEN 0
              ELSE COALESCE((p_items->>('n' || p_number))::BIGINT, 0) * 9 * p_bonus
         END;
$fn$;

-- Whether the Print button may show. The server decides again at each press.
CREATE FUNCTION public.spin2win_print_state()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_user  UUID := auth.uid();
  v_cycle CONSTANT INT := 100;
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

CREATE FUNCTION public.spin2win_print_ticket(p_round_id UUID, p_bets JSONB, p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_user     UUID := auth.uid();
  v_profile  public.profiles;
  v_round    public.spin2win_rounds;
  v_ticket   public.print_tickets;
  v_on       BOOLEAN;
  v_cutoff   INT;
  v_cycle    CONSTANT INT := 100;
  v_into     INT := (EXTRACT(EPOCH FROM NOW())::BIGINT % v_cycle)::INT;
  v_bets     JSONB := COALESCE(p_bets, '{}'::jsonb);
  v_items    JSONB := '{}'::jsonb;
  v_k        TEXT;
  v_val      JSONB;
  v_v        BIGINT;
  v_stake    BIGINT := 0;
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
    RAISE EXCEPTION 'BAD_BET:request' USING errcode = 'P0126';
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

    SELECT bet_cutoff_second INTO v_cutoff FROM public.spin2win_config WHERE id = 'global';

    -- The same closed-round guards as spin2win_place_bet.
    SELECT * INTO v_round FROM public.spin2win_rounds WHERE id = p_round_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
    END IF;
    IF v_round.winning_number IS NOT NULL THEN
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

    -- The same number checks as spin2win_place_bet. The limit is per ticket.
    IF jsonb_typeof(v_bets) <> 'object' THEN
      RAISE EXCEPTION 'BAD_BET:not an object' USING errcode = 'P0126';
    END IF;
    FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_bets) LOOP
      IF v_k NOT IN ('n0','n1','n2','n3','n4','n5','n6','n7','n8','n9') THEN
        RAISE EXCEPTION 'BAD_BET:%', v_k USING errcode = 'P0126';
      END IF;
      IF jsonb_typeof(v_val) <> 'number' OR v_val::text !~ '^-?[0-9]{1,15}$' THEN
        RAISE EXCEPTION 'BAD_BET:%', v_k USING errcode = 'P0126';
      END IF;
      v_v := v_val::text::BIGINT;
      CONTINUE WHEN v_v = 0;
      IF v_v < 5     THEN RAISE EXCEPTION 'BELOW_MIN'   USING errcode = 'P0123'; END IF;
      IF v_v > 10000 THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode = 'P0124'; END IF;
      v_stake := v_stake + v_v;
      v_items := v_items || jsonb_build_object(v_k, v_v);
    END LOOP;

    IF v_stake <= 0 THEN
      RAISE EXCEPTION 'EMPTY_BET' USING errcode = 'P0125';
    END IF;

    BEGIN
      -- Locks the player's counter row, so two presses wait for each other, and
      -- rolls back with everything else on a refusal: no gap in the numbers.
      SELECT a.ticket_no, a.ticket_code INTO v_no, v_code
        FROM public.print_allocate_ticket(v_user, 'SW') a;

      SELECT * INTO v_profile FROM public.profiles WHERE id = v_user FOR UPDATE;
      IF NOT FOUND OR NOT v_profile.is_active THEN
        RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
      END IF;

      v_balance := public.spin2win_apply_coin_movement(v_user, NULL, 'stake', -v_stake, p_round_id, v_code);

      INSERT INTO public.spin2win_bets AS b
        (round_id, user_id,
         n0, n1, n2, n3, n4, n5, n6, n7, n8, n9, total_stake)
      VALUES
        (p_round_id, v_user,
         COALESCE((v_items->>'n0')::BIGINT, 0),
         COALESCE((v_items->>'n1')::BIGINT, 0),
         COALESCE((v_items->>'n2')::BIGINT, 0),
         COALESCE((v_items->>'n3')::BIGINT, 0),
         COALESCE((v_items->>'n4')::BIGINT, 0),
         COALESCE((v_items->>'n5')::BIGINT, 0),
         COALESCE((v_items->>'n6')::BIGINT, 0),
         COALESCE((v_items->>'n7')::BIGINT, 0),
         COALESCE((v_items->>'n8')::BIGINT, 0),
         COALESCE((v_items->>'n9')::BIGINT, 0),
         v_stake)
      ON CONFLICT (round_id, user_id) DO UPDATE
        SET n0 = b.n0 + EXCLUDED.n0,
            n1 = b.n1 + EXCLUDED.n1,
            n2 = b.n2 + EXCLUDED.n2,
            n3 = b.n3 + EXCLUDED.n3,
            n4 = b.n4 + EXCLUDED.n4,
            n5 = b.n5 + EXCLUDED.n5,
            n6 = b.n6 + EXCLUDED.n6,
            n7 = b.n7 + EXCLUDED.n7,
            n8 = b.n8 + EXCLUDED.n8,
            n9 = b.n9 + EXCLUDED.n9,
            total_stake = b.total_stake + EXCLUDED.total_stake;

      INSERT INTO public.print_tickets
        (game, ticket_no, ticket_code, user_id, spin2win_round_id, round_number,
         items, total_stake, client_request_id)
      VALUES
        ('SW', v_no, v_code, v_user, p_round_id, v_round.round_number,
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

  IF v_ticket.game <> 'SW' THEN
    RAISE EXCEPTION 'BAD_BET:request' USING errcode = 'P0126';
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'repeat',         v_repeat,
    'ticket_id',      v_ticket.id,
    'ticket_code',    v_ticket.ticket_code,
    'ticket_no',      v_ticket.ticket_no,
    'round_id',       v_ticket.spin2win_round_id,
    'round_number',   v_ticket.round_number,
    'items',          v_ticket.items,
    'total_stake',    v_ticket.total_stake,
    'print_status',   v_ticket.print_status,
    'created_at',     v_ticket.created_at,
    'round_total',    (SELECT total_stake FROM public.spin2win_bets
                        WHERE round_id = v_ticket.spin2win_round_id AND user_id = v_user),
    'coin_balance',   (SELECT coin_balance FROM public.profiles WHERE id = v_user),
    'ledger_version', (SELECT ledger_version FROM public.profiles WHERE id = v_user)
  );
END;
$fn$;

-- The caller's tickets, newest first, for one round or since a moment.
CREATE FUNCTION public.spin2win_my_tickets(p_round_id UUID DEFAULT NULL, p_since TIMESTAMPTZ DEFAULT NULL)
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
                 'round_id',         t.spin2win_round_id,
                 'round_number',     t.round_number,
                 'items',            t.items,
                 'total_stake',      t.total_stake,
                 'print_status',     t.print_status,
                 'reprint_count',    t.reprint_count,
                 'created_at',       t.created_at,
                 'winning_number',   r.winning_number,
                 'bonus_multiplier', r.bonus_multiplier,
                 'is_drawn',         r.winning_number IS NOT NULL,
                 'win',              public.spin2win_ticket_win(t.items, r.winning_number, r.bonus_multiplier)
               ) AS row
          FROM public.print_tickets t
          JOIN public.spin2win_rounds r ON r.id = t.spin2win_round_id
         WHERE t.user_id = v_user
           AND t.game = 'SW'
           AND (p_round_id IS NULL OR t.spin2win_round_id = p_round_id)
           AND (p_since IS NULL OR t.created_at >= p_since)
         ORDER BY t.created_at DESC, t.ticket_no DESC
         LIMIT 500
      ) s), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.spin2win_ticket_win(JSONB, INT, INT)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spin2win_print_state()                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spin2win_print_ticket(UUID, JSONB, UUID)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spin2win_my_tickets(UUID, TIMESTAMPTZ)           FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.spin2win_ticket_win(JSONB, INT, INT)   TO service_role;
GRANT EXECUTE ON FUNCTION public.spin2win_print_state()                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spin2win_print_ticket(UUID, JSONB, UUID)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spin2win_my_tickets(UUID, TIMESTAMPTZ)        TO authenticated, service_role;

COMMENT ON FUNCTION public.spin2win_print_ticket(UUID, JSONB, UUID) IS
  'Buys one printed Spin2Win ticket for the caller: charges its stake and adds '
  'it to their bet row. One ticket per press.';
COMMENT ON FUNCTION public.spin2win_my_tickets(UUID, TIMESTAMPTZ) IS
  'The caller''s Spin2Win tickets with the win of each. For showing only.';

COMMIT;
