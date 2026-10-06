-- #############################################################################
-- LUCKY CARD - GAME FUNCTIONS 4 of 6: PLACING A BET
-- Migration: 20261005120000_lucky_card_place_bet.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 3 (betting model), 8 (limits), 14.17
-- #############################################################################
--
-- PURELY ADDITIVE. Creates one new function. Nothing belonging to Triple
-- Chance is altered, dropped, replaced or called; place_bet() is untouched.
--
-- WHAT IT DOES
-- ------------
-- Called by a signed-in PLAYER with the round id and one JSON object of chips
-- per card, e.g. {"j_hearts": 50, "k_clubs": 100}. It validates the bet,
-- charges the wallet and stores the bet. Sending again REPLACES the earlier
-- bet for that round and only the DIFFERENCE is charged (a stake) or given
-- back (a stake_refund), exactly as place_bet() does.
--
-- CARD KEYS (12): j_hearts j_spades j_diamonds j_clubs
--                 q_hearts q_spades q_diamonds q_clubs
--                 k_hearts k_spades k_diamonds k_clubs
-- A card left out, or sent as 0, carries no chips. Every other amount must be
-- a whole number from 5 to 50,000 (spec 8, hardcoded here and also enforced by
-- the CHECK constraints on lucky_card_bets). There is no round-total cap.
--
-- REFUSALS (SQLSTATE)
--   P0100 Unauthenticated          P0113 ACCOUNT_BLOCKED     P0114 not a player
--   P0120 ROUND_NOT_FOUND          P0121 ROUND_CLOSED (drawn, past the cutoff
--   P0123 BELOW_MIN                       second, or not the current round)
--   P0124 EXCEEDS_MAX              P0125 EMPTY_BET           P0112 INSUFFICIENT_COINS
--   P0126 BAD_BET (NEW) - the bet is not a JSON object, a key is not one of the
--         12 cards, or an amount is not a whole number.
--
-- LOCKING - OPTION B, chosen by the user 2026-10-05
-- -------------------------------------------------
-- Triple Chance's place_bet() locks the round row FOR UPDATE, so every bet in
-- a round is processed one at a time. This function takes the round row
-- FOR SHARE instead:
--   * many players' bets hold the share lock together and run in parallel;
--   * lucky_card_draw_round() and lucky_card_settle_round() take the row FOR
--     UPDATE, which WAITS for every in-flight bet to finish and then blocks new
--     ones. A bet can therefore never be charged yet missed by the draw, and a
--     bet that arrives while the draw holds the row is re-read after the draw
--     commits and refused as ROUND_CLOSED, uncharged.
--   * the share lock no longer serialises one PLAYER's own requests, so the
--     player's profile row is locked FOR UPDATE before the previous bet is
--     read. Two taps from one player therefore run one after the other and the
--     second sees the first (without this, both would read "no previous bet"
--     and both charge the full stake).
--   Lock order is always ROUND then PROFILE, the same order
--   lucky_card_settle_round() uses (round, then the winners' profiles), so the
--   two cannot deadlock. The profile is read once unlocked, for the early
--   account checks only, before any round lock is taken.
-- #############################################################################

BEGIN;

CREATE FUNCTION public.lucky_card_place_bet(p_round_id UUID, p_bets JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_user     UUID := auth.uid();
  v_profile  public.profiles;
  v_round    public.lucky_card_rounds;
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

  -- Early account check, unlocked: it must come before any round lock so the
  -- lock order stays round -> profile.
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;
  IF v_profile.role <> 'player' THEN
    RAISE EXCEPTION 'Only players may place bets' USING errcode = 'P0114';
  END IF;

  SELECT bet_cutoff_second INTO v_cutoff FROM public.lucky_card_config WHERE id = 'global';

  -- FOR SHARE, not FOR UPDATE: bets run in parallel; the draw and settlement
  -- take FOR UPDATE and wait for them. If the draw holds the row, this waits
  -- and then re-reads the row as the draw left it.
  SELECT * INTO v_round FROM public.lucky_card_rounds WHERE id = p_round_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
  END IF;

  -- Three independent closed-round guards, as in place_bet().
  IF v_round.winning_rank IS NOT NULL THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_into >= v_cutoff THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_round.round_number <> (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;

  -- Validate every card and total the stake. Limits are hardcoded (spec 8).
  IF jsonb_typeof(v_bets) <> 'object' THEN
    RAISE EXCEPTION 'BAD_BET:not an object' USING errcode = 'P0126';
  END IF;
  FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_bets) LOOP
    IF v_k NOT IN ('j_hearts','j_spades','j_diamonds','j_clubs',
                   'q_hearts','q_spades','q_diamonds','q_clubs',
                   'k_hearts','k_spades','k_diamonds','k_clubs') THEN
      RAISE EXCEPTION 'BAD_BET:%', v_k USING errcode = 'P0126';
    END IF;
    IF jsonb_typeof(v_val) <> 'number' OR v_val::text !~ '^-?[0-9]{1,15}$' THEN
      RAISE EXCEPTION 'BAD_BET:%', v_k USING errcode = 'P0126';
    END IF;
    v_v := v_val::text::BIGINT;
    CONTINUE WHEN v_v = 0;
    IF v_v < 5     THEN RAISE EXCEPTION 'BELOW_MIN'   USING errcode = 'P0123'; END IF;
    IF v_v > 50000 THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode = 'P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  IF v_stake <= 0 THEN
    RAISE EXCEPTION 'EMPTY_BET' USING errcode = 'P0125';
  END IF;

  -- Serialise this player's own requests (see header), and re-check the
  -- account now that the row is locked.
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;

  -- Replacing an existing bet charges only the difference.
  SELECT total_stake INTO v_prev FROM public.lucky_card_bets
    WHERE round_id = p_round_id AND user_id = v_user FOR UPDATE;
  v_prev  := COALESCE(v_prev, 0);
  v_delta := v_stake - v_prev;

  IF v_delta <> 0 THEN
    -- A reduced bet is a stake_refund, never a 'payout'.
    v_balance := public.lucky_card_apply_coin_movement(
      v_user, NULL, CASE WHEN v_delta > 0 THEN 'stake' ELSE 'stake_refund' END,
      -v_delta, p_round_id);
  ELSE
    v_balance := v_profile.coin_balance;
  END IF;

  INSERT INTO public.lucky_card_bets
    (round_id, user_id,
     j_hearts, j_spades, j_diamonds, j_clubs,
     q_hearts, q_spades, q_diamonds, q_clubs,
     k_hearts, k_spades, k_diamonds, k_clubs, total_stake)
  VALUES
    (p_round_id, v_user,
     COALESCE((v_bets->>'j_hearts')::BIGINT, 0),   COALESCE((v_bets->>'j_spades')::BIGINT, 0),
     COALESCE((v_bets->>'j_diamonds')::BIGINT, 0), COALESCE((v_bets->>'j_clubs')::BIGINT, 0),
     COALESCE((v_bets->>'q_hearts')::BIGINT, 0),   COALESCE((v_bets->>'q_spades')::BIGINT, 0),
     COALESCE((v_bets->>'q_diamonds')::BIGINT, 0), COALESCE((v_bets->>'q_clubs')::BIGINT, 0),
     COALESCE((v_bets->>'k_hearts')::BIGINT, 0),   COALESCE((v_bets->>'k_spades')::BIGINT, 0),
     COALESCE((v_bets->>'k_diamonds')::BIGINT, 0), COALESCE((v_bets->>'k_clubs')::BIGINT, 0),
     v_stake)
  ON CONFLICT (round_id, user_id) DO UPDATE
    SET j_hearts = EXCLUDED.j_hearts, j_spades = EXCLUDED.j_spades,
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

-- Players and the server only. Default privileges would otherwise also grant
-- EXECUTE to anon (Issue #120). CREATE OR REPLACE keeps grants; DROP + CREATE
-- does not.
REVOKE ALL ON FUNCTION public.lucky_card_place_bet(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lucky_card_place_bet(UUID, JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.lucky_card_place_bet(UUID, JSONB) IS
  'Places or replaces the calling player''s Lucky Card bet for a round: one JSON '
  'object of chips per card (5 to 50,000 each), charging only the difference to '
  'any earlier bet. Bets run in parallel (round row FOR SHARE); the draw waits '
  'for them. Signed-in players and service_role.';

COMMIT;
