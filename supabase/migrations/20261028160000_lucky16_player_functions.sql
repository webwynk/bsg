-- #############################################################################
-- LUCKY 16 CARD - STEP 6: THE FOUR FUNCTIONS THE APP CALLS
-- Migration: 20261028160000_lucky16_player_functions.sql
-- Plan: "Lucky 16 Card: build plan" step 6
-- #############################################################################
--
-- PURELY ADDITIVE. Creates four new functions, each a Lucky 16 Card twin of
-- the live Lucky Card function of the same role, returning the same JSON shape
-- so the app's copied Lucky Card code reads them unchanged. Nothing belonging
-- to Triple Chance, Lucky Card or Spin2Win is altered, dropped, replaced or
-- called.
--
--   lucky16_get_current_round()          the round on screen now; creates it
--                                        if needed, draws + settles it once
--                                        the draw second is reached
--   lucky16_place_bet(round, bets)       charges and stores a player's board
--   lucky16_get_my_round_result(round)   the player's own stake / payout
--   lucky16_get_recent_rounds(limit)     the latest results (history)
--
-- ROUND CLOCK: 103-second cycle, as Lucky Card (Hasan, 2026-10-28).
--   round_number   = floor(epoch / 103)
--   seconds_into   = epoch % 103    (0..102)
--   bet cutoff     = lucky16_config.bet_cutoff_second (88)
--   draw           = lucky16_config.draw_at_second    (89)
--
-- BONUS DIAL: as Lucky Card, lucky16_config.bonus_multiplier is ONE-SHOT. It
-- is pinned onto the next round created and then returns to 1 (N).
--
-- BETS: one JSON object of chips per card, keys a_hearts .. k_clubs, e.g.
-- {"a_hearts": 10, "k_clubs": 50}. A card left out, or 0, carries no chips;
-- every other amount must be a whole number from 5 to 10,000 (Hasan,
-- 2026-10-28; also enforced by the CHECKs on lucky16_bets). Sending again
-- REPLACES the earlier bet for that round and only the DIFFERENCE is charged
-- (stake) or given back (stake_refund), exactly as lucky_card_place_bet does.
-- Locking is the same as Lucky Card's (round FOR SHARE, then profile FOR
-- UPDATE; draw and settle take the round FOR UPDATE), so a bet can never be
-- charged yet missed by the draw.
--
-- REFUSALS (SQLSTATE) - the same codes Lucky Card uses, so the app handles
-- them the same way:
--   P0100 Unauthenticated          P0113 ACCOUNT_BLOCKED     P0114 not a player
--   P0120 ROUND_NOT_FOUND          P0121 ROUND_CLOSED        P0112 INSUFFICIENT_COINS
--   P0123 BELOW_MIN                P0124 EXCEEDS_MAX         P0125 EMPTY_BET
--   P0126 BAD_BET (not an object, unknown key, or not a whole number)
-- #############################################################################

BEGIN;

-- =============================================================================
-- lucky16_get_current_round
-- =============================================================================
-- Polled by every player's app. A draw/settle failure is written to
-- audit_log (one 'system' row, prefixed 'lucky16_get_current_round:') and
-- never reaches the caller; the next poll or tick retries.
CREATE FUNCTION public.lucky16_get_current_round()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cycle       CONSTANT INT := 103;
  v_now         BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_number      BIGINT := v_now / v_cycle;
  v_into        INT    := (v_now % v_cycle)::INT;
  v_left        INT    := v_cycle - (v_now % v_cycle)::INT;
  v_draw_at     INT;
  v_rtp         NUMERIC;
  v_bonus       SMALLINT;
  v_round       public.lucky16_rounds;
  v_inserted_id UUID;
BEGIN
  SELECT draw_at_second, rtp_percentage, bonus_multiplier
    INTO v_draw_at, v_rtp, v_bonus
    FROM public.lucky16_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.lucky16_rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    -- Many clients reach a new round in the same second. ON CONFLICT lets
    -- exactly one INSERT win; the others fall through to the SELECT below.
    INSERT INTO public.lucky16_rounds (round_number, scheduled_at, phase, rtp_percentage, bonus_multiplier)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting', v_rtp, v_bonus)
    ON CONFLICT (round_number) DO NOTHING
    RETURNING id INTO v_inserted_id;

    -- One-shot bonus dial: reset only by the caller that won the INSERT, and
    -- only if the dial still holds the value captured above.
    IF v_inserted_id IS NOT NULL AND v_bonus <> 1 THEN
      UPDATE public.lucky16_config SET bonus_multiplier = 1, updated_at = NOW()
       WHERE id = 'global' AND bonus_multiplier = v_bonus;
    END IF;

    SELECT * INTO v_round FROM public.lucky16_rounds WHERE round_number = v_number;
  END IF;

  IF v_into >= v_draw_at AND v_round.phase <> 'settled' THEN
    BEGIN
      IF v_round.winning_rank IS NULL THEN
        PERFORM public.lucky16_draw_round(v_round.id);
      END IF;
      PERFORM public.lucky16_settle_round(v_round.id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_log (actor_id, kind, detail)
      VALUES (NULL, 'system',
        format('lucky16_get_current_round: round %s failed to draw/settle: %s', v_round.id, SQLERRM));
    END;
    SELECT * INTO v_round FROM public.lucky16_rounds WHERE round_number = v_number;
  END IF;

  -- The winning card and the bonus are hidden until the round is drawn.
  RETURN jsonb_build_object(
    'round_id',          v_round.id,
    'round_number',      v_round.round_number,
    'phase',             v_round.phase,
    'scheduled_at',      v_round.scheduled_at,
    'seconds_remaining', v_left,
    'seconds_into',      v_into,
    'draw_at_second',    v_draw_at,
    'winning_rank',      v_round.winning_rank,
    'winning_suit',      v_round.winning_suit,
    'bonus_multiplier',  CASE WHEN v_round.winning_rank IS NULL THEN NULL ELSE v_round.bonus_multiplier END
  );
END;
$fn$;

-- =============================================================================
-- lucky16_place_bet
-- =============================================================================
CREATE FUNCTION public.lucky16_place_bet(p_round_id UUID, p_bets JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_user     UUID := auth.uid();
  v_profile  public.profiles;
  v_round    public.lucky16_rounds;
  v_cutoff   INT;
  v_cycle    CONSTANT INT := 103;
  v_into     INT := (EXTRACT(EPOCH FROM NOW())::BIGINT % v_cycle)::INT;
  v_bets     JSONB := COALESCE(p_bets, '{}'::jsonb);
  v_k        TEXT;
  v_val      JSONB;
  v_v        BIGINT;
  v_stake    BIGINT := 0;
  v_prev     BIGINT := 0;
  v_delta    BIGINT;
  v_balance  BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  -- Early account check, unlocked: before any round lock so the lock order
  -- stays round -> profile.
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;
  IF v_profile.role <> 'player' THEN
    RAISE EXCEPTION 'Only players may place bets' USING errcode = 'P0114';
  END IF;

  SELECT bet_cutoff_second INTO v_cutoff FROM public.lucky16_config WHERE id = 'global';

  -- FOR SHARE: bets run in parallel; draw and settle take FOR UPDATE and wait.
  SELECT * INTO v_round FROM public.lucky16_rounds WHERE id = p_round_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
  END IF;

  -- Three independent closed-round guards.
  IF v_round.winning_rank IS NOT NULL THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_into >= v_cutoff THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_round.round_number <> (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;

  -- Validate every card and total the stake. Limits are fixed: 5 to 10,000.
  IF jsonb_typeof(v_bets) <> 'object' THEN
    RAISE EXCEPTION 'BAD_BET:not an object' USING errcode = 'P0126';
  END IF;
  FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_bets) LOOP
    IF v_k NOT IN ('a_hearts', 'a_spades', 'a_diamonds', 'a_clubs',
                   'j_hearts', 'j_spades', 'j_diamonds', 'j_clubs',
                   'q_hearts', 'q_spades', 'q_diamonds', 'q_clubs',
                   'k_hearts', 'k_spades', 'k_diamonds', 'k_clubs') THEN
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
  END LOOP;

  IF v_stake <= 0 THEN
    RAISE EXCEPTION 'EMPTY_BET' USING errcode = 'P0125';
  END IF;

  -- Serialise this player's own requests, and re-check the account locked.
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;

  -- Replacing an existing bet charges only the difference.
  SELECT total_stake INTO v_prev FROM public.lucky16_bets
    WHERE round_id = p_round_id AND user_id = v_user FOR UPDATE;
  v_prev  := COALESCE(v_prev, 0);
  v_delta := v_stake - v_prev;

  IF v_delta <> 0 THEN
    -- A reduced bet is a stake_refund, never a 'payout'.
    v_balance := public.lucky16_apply_coin_movement(
      v_user, NULL, CASE WHEN v_delta > 0 THEN 'stake' ELSE 'stake_refund' END,
      -v_delta, p_round_id);
  ELSE
    v_balance := v_profile.coin_balance;
  END IF;

  INSERT INTO public.lucky16_bets
    (round_id, user_id,
     a_hearts, a_spades, a_diamonds, a_clubs,
     j_hearts, j_spades, j_diamonds, j_clubs,
     q_hearts, q_spades, q_diamonds, q_clubs,
     k_hearts, k_spades, k_diamonds, k_clubs, total_stake)
  VALUES
    (p_round_id, v_user,
     COALESCE((v_bets->>'a_hearts')::BIGINT, 0), COALESCE((v_bets->>'a_spades')::BIGINT, 0),
     COALESCE((v_bets->>'a_diamonds')::BIGINT, 0), COALESCE((v_bets->>'a_clubs')::BIGINT, 0),
     COALESCE((v_bets->>'j_hearts')::BIGINT, 0), COALESCE((v_bets->>'j_spades')::BIGINT, 0),
     COALESCE((v_bets->>'j_diamonds')::BIGINT, 0), COALESCE((v_bets->>'j_clubs')::BIGINT, 0),
     COALESCE((v_bets->>'q_hearts')::BIGINT, 0), COALESCE((v_bets->>'q_spades')::BIGINT, 0),
     COALESCE((v_bets->>'q_diamonds')::BIGINT, 0), COALESCE((v_bets->>'q_clubs')::BIGINT, 0),
     COALESCE((v_bets->>'k_hearts')::BIGINT, 0), COALESCE((v_bets->>'k_spades')::BIGINT, 0),
     COALESCE((v_bets->>'k_diamonds')::BIGINT, 0), COALESCE((v_bets->>'k_clubs')::BIGINT, 0),
     v_stake)
  ON CONFLICT (round_id, user_id) DO UPDATE
    SET a_hearts = EXCLUDED.a_hearts, a_spades = EXCLUDED.a_spades,
        a_diamonds = EXCLUDED.a_diamonds, a_clubs = EXCLUDED.a_clubs,
        j_hearts = EXCLUDED.j_hearts, j_spades = EXCLUDED.j_spades,
        j_diamonds = EXCLUDED.j_diamonds, j_clubs = EXCLUDED.j_clubs,
        q_hearts = EXCLUDED.q_hearts, q_spades = EXCLUDED.q_spades,
        q_diamonds = EXCLUDED.q_diamonds, q_clubs = EXCLUDED.q_clubs,
        k_hearts = EXCLUDED.k_hearts, k_spades = EXCLUDED.k_spades,
        k_diamonds = EXCLUDED.k_diamonds, k_clubs = EXCLUDED.k_clubs,
        total_stake = EXCLUDED.total_stake,
        is_settled = false, total_payout = 0, settled_at = NULL;

  RETURN jsonb_build_object(
    'success',        true,
    'total_stake',    v_stake,
    'coin_balance',   v_balance,
    'ledger_version', (SELECT ledger_version FROM public.profiles WHERE id = v_user)
  );
END;
$fn$;

-- =============================================================================
-- lucky16_get_my_round_result
-- =============================================================================
-- The caller's own stake and payout for one round, plus their live balance,
-- used after the wheel lands (win popup, WIN box, history row).
CREATE FUNCTION public.lucky16_get_my_round_result(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_user UUID := auth.uid();
  v_bet  public.lucky16_bets;
  v_p    public.profiles;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_user;
  SELECT * INTO v_bet FROM public.lucky16_bets WHERE round_id = p_round_id AND user_id = v_user;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'placed_bet', false, 'total_stake', 0, 'total_payout', 0,
      'is_settled', false,
      'coin_balance', v_p.coin_balance, 'ledger_version', v_p.ledger_version);
  END IF;

  RETURN jsonb_build_object(
    'placed_bet',     true,
    'total_stake',    v_bet.total_stake,
    'total_payout',   v_bet.total_payout,
    'is_settled',     v_bet.is_settled,
    'coin_balance',   v_p.coin_balance,
    'ledger_version', v_p.ledger_version
  );
END;
$fn$;

-- =============================================================================
-- lucky16_get_recent_rounds
-- =============================================================================
-- The latest drawn results, newest first, global to every player. Capped at 50.
CREATE FUNCTION public.lucky16_get_recent_rounds(p_limit INTEGER DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(x ORDER BY x_round_number DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT r.round_number AS x_round_number,
           jsonb_build_object(
             'round_id',         r.id,
             'round_number',     r.round_number,
             'winning_rank',     r.winning_rank,
             'winning_suit',     r.winning_suit,
             'bonus_multiplier', r.bonus_multiplier,
             'scheduled_at',     r.scheduled_at
           ) AS x
      FROM public.lucky16_rounds r
     WHERE r.winning_rank IS NOT NULL
     ORDER BY r.round_number DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
  ) s;
  RETURN v;
END;
$fn$;

-- =============================================================================
-- PRIVILEGES - signed-in players and the server, never anon
-- =============================================================================
-- Matches the live ACL of the Lucky Card and Spin2Win twins:
-- {postgres, authenticated, service_role}. Default privileges would also grant
-- anon (Issue #120), so revoke first.
REVOKE ALL ON FUNCTION public.lucky16_get_current_round()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lucky16_place_bet(UUID, JSONB)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lucky16_get_my_round_result(UUID)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lucky16_get_recent_rounds(INTEGER)        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lucky16_get_current_round()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lucky16_place_bet(UUID, JSONB)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lucky16_get_my_round_result(UUID)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lucky16_get_recent_rounds(INTEGER)     TO authenticated, service_role;

COMMENT ON FUNCTION public.lucky16_get_current_round() IS
  'The current 103-second Lucky 16 Card round. Creates it if needed (pinning '
  'RTP and the one-shot bonus), and draws + settles it once draw_at_second is '
  'reached; failures go to audit_log, never to the caller. Hides the card and '
  'bonus until drawn.';
COMMENT ON FUNCTION public.lucky16_place_bet(UUID, JSONB) IS
  'Places or replaces the caller''s Lucky 16 Card board for the current round: '
  '{"a_hearts".."k_clubs": 0 or 5..10000}. Charges or refunds only the '
  'difference via lucky16_apply_coin_movement. Refused after bet_cutoff_second.';
COMMENT ON FUNCTION public.lucky16_get_my_round_result(UUID) IS
  'The caller''s own stake, payout and settled flag for one Lucky 16 Card '
  'round, with their live balance and ledger_version.';
COMMENT ON FUNCTION public.lucky16_get_recent_rounds(INTEGER) IS
  'Latest drawn Lucky 16 Card results (rank, suit and bonus), newest first; '
  'default 10, max 50.';

COMMIT;
