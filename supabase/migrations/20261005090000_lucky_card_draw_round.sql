-- #############################################################################
-- LUCKY CARD - GAME FUNCTIONS 1 of 6: THE DRAW
-- Migration: 20261005090000_lucky_card_draw_round.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 4.1 (Option C, weighted random)
-- #############################################################################
--
-- PURELY ADDITIVE. Creates two new functions. Nothing belonging to Triple
-- Chance is altered, dropped, replaced or called: draw_round(), its RTP logic
-- and random_index_unbiased() are untouched and unused here.
--
--   lucky_card_random_int(n)      unbiased random integer in [0, n)
--   lucky_card_draw_round(round)  picks the winning card for one round
--
-- WHY THIS IS NOT A COPY OF draw_round()
-- --------------------------------------
-- Triple Chance picks the result whose payout is CLOSEST to stake x RTP, with
-- no randomness unless results tie. With few bettors that gives fixed patterns
-- (a lone small bet never wins; a lone bet on about half the board always
-- wins above 100%). The user chose a weighted random draw for Lucky Card
-- instead (spec 4.1, decided 2026-10-05).
--
-- THE RULE
-- --------
-- s[c]  = total staked on card c by all players in the round (12 values)
-- T     = sum of s[c]
-- rho   = the round's own pinned rtp_percentage / 100
--
--   1. T = 0            -> uniform over the 12 cards.
--   2. target = rho*T/10   (the stake the winning card must carry on average
--                           for the payout, 10 x that stake, to average rho*T)
--      mean   = T/12       (what a fair draw gives)
--   3. target > mean    -> s_ext = the highest stake on any card
--      target < mean    -> s_ext = the lowest stake on any card
--      target = mean, or all 12 stakes equal -> uniform.
--   4. lambda = min(1, |target - mean| / |s_ext - mean|)
--   5. with probability lambda: uniform among the cards whose stake = s_ext
--      otherwise:               uniform among all 12 cards
--
-- Average payout = 10 * ((1-lambda)*mean + lambda*s_ext) = rho*T whenever
-- lambda is not clamped. At rho = 10/12 (83.33%) lambda is 0 and the draw is
-- exactly fair. When the target cannot be reached (for example every card
-- covered equally) lambda clamps and the round pays as near as stakes allow.
--
-- The bonus multiplier is deliberately NOT part of this calculation. As in
-- Triple Chance it is applied only at settlement, as extra payout.
-- #############################################################################

BEGIN;

-- ---------------------------------------------------------------------------
-- lucky_card_random_int
-- ---------------------------------------------------------------------------
-- Unbiased integer in [0, p_n), from 4 cryptographically random bytes with
-- rejection sampling (values at or above the largest multiple of p_n below
-- 2^32 are discarded, so no residue is favoured). Lucky Card has its own
-- helper rather than calling Triple Chance's random_index_unbiased(): that
-- function draws from 2 bytes only and never terminates for p_n > 65536,
-- and the draw below needs a range of 1,000,000.
CREATE FUNCTION public.lucky_card_random_int(p_n INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $fn$
DECLARE
  v_span  CONSTANT BIGINT := 4294967296;   -- 2^32
  v_limit BIGINT;
  v_b     BYTEA;
  v_val   BIGINT;
BEGIN
  IF p_n IS NULL OR p_n < 1 OR p_n > 1000000000 THEN
    RAISE EXCEPTION 'lucky_card_random_int: range must be 1..1000000000' USING errcode = 'P0117';
  END IF;

  v_limit := (v_span / p_n) * p_n;
  LOOP
    v_b   := extensions.gen_random_bytes(4);
    v_val := get_byte(v_b, 0)::BIGINT * 16777216
           + get_byte(v_b, 1)::BIGINT * 65536
           + get_byte(v_b, 2)::BIGINT * 256
           + get_byte(v_b, 3)::BIGINT;
    EXIT WHEN v_val < v_limit;
  END LOOP;

  RETURN (v_val % p_n)::INTEGER;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- lucky_card_draw_round
-- ---------------------------------------------------------------------------
-- Draws the winning card for one round, once. Locks the round row, so two
-- concurrent callers cannot both draw: the second finds the card already set
-- and returns it unchanged. Sets phase = 'drawing', records the pooled stake
-- and drawn_at, exactly as draw_round() does for Triple Chance. Paying the
-- winners is lucky_card_settle_round()'s job, not this function's.
--
-- Card order used for the stake array, and for mapping the pick back to a
-- card: J hearts, J spades, J diamonds, J clubs, then Q, then K in the same
-- suit order. This matches the column order of lucky_card_bets.
CREATE FUNCTION public.lucky_card_draw_round(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_round   public.lucky_card_rounds;
  v_s       BIGINT[];
  v_total   BIGINT := 0;
  v_max     BIGINT;
  v_min     BIGINT;
  v_ext     BIGINT;
  v_target  NUMERIC;
  v_mean    NUMERIC;
  v_lambda  NUMERIC := 0;
  v_idx     INT;
  v_n_ext   INT := 0;
  v_k       INT;
  v_i       INT;
  v_ranks   CONSTANT TEXT[] := ARRAY['J','Q','K'];
  v_suits   CONSTANT TEXT[] := ARRAY['hearts','spades','diamonds','clubs'];
  v_rank    TEXT;
  v_suit    TEXT;
BEGIN
  SELECT * INTO v_round FROM public.lucky_card_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.winning_rank IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true,
      'winning_rank', v_round.winning_rank, 'winning_suit', v_round.winning_suit);
  END IF;

  -- Pool every player's stake per card.
  SELECT ARRAY[
           COALESCE(sum(j_hearts),0), COALESCE(sum(j_spades),0), COALESCE(sum(j_diamonds),0), COALESCE(sum(j_clubs),0),
           COALESCE(sum(q_hearts),0), COALESCE(sum(q_spades),0), COALESCE(sum(q_diamonds),0), COALESCE(sum(q_clubs),0),
           COALESCE(sum(k_hearts),0), COALESCE(sum(k_spades),0), COALESCE(sum(k_diamonds),0), COALESCE(sum(k_clubs),0)
         ]::BIGINT[]
    INTO v_s
    FROM public.lucky_card_bets
   WHERE round_id = p_round_id;

  v_max := v_s[1];
  v_min := v_s[1];
  FOR v_i IN 1..12 LOOP
    v_total := v_total + v_s[v_i];
    IF v_s[v_i] > v_max THEN v_max := v_s[v_i]; END IF;
    IF v_s[v_i] < v_min THEN v_min := v_s[v_i]; END IF;
  END LOOP;

  IF v_total > 0 AND v_max <> v_min THEN
    v_target := v_total * v_round.rtp_percentage / 1000.0;   -- rho * T / 10
    v_mean   := v_total / 12.0;
    IF v_target > v_mean THEN
      v_ext := v_max;
    ELSIF v_target < v_mean THEN
      v_ext := v_min;
    END IF;
    IF v_ext IS NOT NULL THEN
      v_lambda := LEAST(1.0, abs(v_target - v_mean) / abs(v_ext - v_mean));
    END IF;
  END IF;

  -- One random draw decides whether this round is tilted; resolution 1e-6.
  IF v_lambda > 0 AND public.lucky_card_random_int(1000000) < v_lambda * 1000000 THEN
    FOR v_i IN 1..12 LOOP
      IF v_s[v_i] = v_ext THEN v_n_ext := v_n_ext + 1; END IF;
    END LOOP;
    v_k := public.lucky_card_random_int(v_n_ext);
    FOR v_i IN 1..12 LOOP
      IF v_s[v_i] = v_ext THEN
        IF v_k = 0 THEN v_idx := v_i; EXIT; END IF;
        v_k := v_k - 1;
      END IF;
    END LOOP;
  ELSE
    v_idx := public.lucky_card_random_int(12) + 1;
  END IF;

  v_rank := v_ranks[(v_idx - 1) / 4 + 1];
  v_suit := v_suits[(v_idx - 1) % 4 + 1];

  UPDATE public.lucky_card_rounds
     SET winning_rank = v_rank, winning_suit = v_suit,
         phase = 'drawing', total_stake = v_total, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('winning_rank', v_rank, 'winning_suit', v_suit,
                            'total_stake', v_total);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES - internal functions, service_role only.
-- ---------------------------------------------------------------------------
-- Default privileges on this database grant EXECUTE on every new function to
-- anon and authenticated (Issue #120). A draw function callable by a client
-- would let a player force a draw; draw_round()'s own live ACL is
-- {postgres, service_role} and these mirror it. DROP + CREATE would re-open
-- them to anon; CREATE OR REPLACE keeps these grants.
REVOKE ALL ON FUNCTION public.lucky_card_random_int(INTEGER)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lucky_card_draw_round(UUID)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lucky_card_random_int(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.lucky_card_draw_round(UUID)    TO service_role;

COMMENT ON FUNCTION public.lucky_card_random_int(INTEGER) IS
  'Unbiased random integer in [0, n) from 4 random bytes with rejection '
  'sampling. Internal to Lucky Card; service_role only.';
COMMENT ON FUNCTION public.lucky_card_draw_round(UUID) IS
  'Draws the winning card for one Lucky Card round, once, under a row lock. '
  'Weighted random: the average payout equals the round''s pinned RTP; at '
  '83.33% it is a fair draw (spec 4.1). Does not pay anyone and ignores the '
  'bonus multiplier; settlement does both. Internal; service_role only.';

COMMIT;
