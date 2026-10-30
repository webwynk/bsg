-- #############################################################################
-- LUCKY 16 CARD - STEP 5: THE DRAW AND THE SETTLEMENT
-- Migration: 20261028150000_lucky16_draw_and_settle.sql
-- Plan: "Lucky 16 Card: build plan" step 5
-- #############################################################################
--
-- PURELY ADDITIVE. Creates three new functions:
--   lucky16_random_int(n)        unbiased random integer in [0, n)
--   lucky16_draw_round(round)    picks the winning card for one round
--   lucky16_settle_round(round)  pays the winners of one drawn round
-- Nothing belonging to Triple Chance, Lucky Card or Spin2Win is altered,
-- dropped, replaced or CALLED. Lucky 16 Card has its own copies so it can
-- never depend on, or break, another game's function.
--
-- THE DRAW (the Lucky Card weighted-random rule, with 16 cards and 14x)
-- ---------------------------------------------------------------------
-- s[c]  = total staked on card c by all players in the round (16 values)
-- T     = sum of s[c]
-- rho   = the round's own pinned rtp_percentage / 100
--
--   1. T = 0            -> uniform over the 16 cards.
--   2. target = rho*T/14   (the stake the winning card must carry on average
--                           for the payout, 14 x that stake, to average rho*T)
--      mean   = T/16       (what a fair draw gives)
--   3. target > mean    -> s_ext = the highest stake on any card
--      target < mean    -> s_ext = the lowest stake on any card
--      target = mean, or all 16 stakes equal -> uniform.
--   4. lambda = min(1, |target - mean| / |s_ext - mean|)
--   5. with probability lambda: uniform among the cards whose stake = s_ext
--      otherwise:               uniform among all 16 cards
--
-- Average payout = 14 * ((1-lambda)*mean + lambda*s_ext) = rho*T whenever
-- lambda is not clamped. At rho = 87.5% lambda is 0 and the draw is exactly
-- fair; at the default 90% it leans slightly toward the cards carrying more
-- coins. A board covered equally on all 16 cards always returns 87.5%. The
-- bonus multiplier is deliberately NOT part of the draw; as in the other
-- games it is applied only at settlement, as extra payout.
--
-- Card order (array index 1..16 and the bets table's column order):
-- A hearts, A spades, A diamonds, A clubs, then J, Q, K in the same suit order.
--
-- THE SETTLEMENT
-- --------------
-- payout = stake on the winning card x 14 x the round's pinned bonus
-- (bonus 1 = N). Hasan's example (2026-10-28): 5 on each of the 16 cards = 80
-- staked; the winning card pays 5 x 14 = 70 with N, 140 with 2X. The stake was
-- already taken when the bet was placed, so the payout is what the balance
-- goes up by. Same batched shape as lucky_card_settle_round and
-- spin2win_settle_round: settle_batch_size bets per call, one ledger row per
-- winner, round marked settled when a batch comes back short. Idempotent.
--
-- ERROR CODES: P0120 (round not found) is reused, as the other games do.
-- P0141 is new (lucky16_random_int range); verified free 2026-10-28 (Step 1).
-- #############################################################################

BEGIN;

-- ---------------------------------------------------------------------------
-- lucky16_random_int
-- ---------------------------------------------------------------------------
-- Unbiased integer in [0, p_n), from 4 cryptographically random bytes with
-- rejection sampling. A copy of spin2win_random_int / lucky_card_random_int,
-- kept separate so the games never share a function.
CREATE FUNCTION public.lucky16_random_int(p_n INTEGER)
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
    RAISE EXCEPTION 'lucky16_random_int: range must be 1..1000000000' USING errcode = 'P0141';
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
-- lucky16_draw_round
-- ---------------------------------------------------------------------------
-- Draws the winning card for one round, once, under a row lock (a second
-- caller finds it set and gets it back unchanged). Sets phase = 'drawing',
-- the pooled stake and drawn_at. Paying is lucky16_settle_round's job.
-- The rule is described in the header above.
CREATE FUNCTION public.lucky16_draw_round(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_round   public.lucky16_rounds;
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
  v_ranks   CONSTANT TEXT[] := ARRAY['A','J','Q','K'];
  v_suits   CONSTANT TEXT[] := ARRAY['hearts','spades','diamonds','clubs'];
  v_rank    TEXT;
  v_suit    TEXT;
BEGIN
  SELECT * INTO v_round FROM public.lucky16_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.winning_rank IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true,
      'winning_rank', v_round.winning_rank, 'winning_suit', v_round.winning_suit);
  END IF;

  -- Pool every player's stake per card, in the card order above.
  SELECT ARRAY[
           COALESCE(sum(a_hearts),0), COALESCE(sum(a_spades),0), COALESCE(sum(a_diamonds),0), COALESCE(sum(a_clubs),0),
           COALESCE(sum(j_hearts),0), COALESCE(sum(j_spades),0), COALESCE(sum(j_diamonds),0), COALESCE(sum(j_clubs),0),
           COALESCE(sum(q_hearts),0), COALESCE(sum(q_spades),0), COALESCE(sum(q_diamonds),0), COALESCE(sum(q_clubs),0),
           COALESCE(sum(k_hearts),0), COALESCE(sum(k_spades),0), COALESCE(sum(k_diamonds),0), COALESCE(sum(k_clubs),0)
         ]::BIGINT[]
    INTO v_s
    FROM public.lucky16_bets
   WHERE round_id = p_round_id;

  v_max := v_s[1];
  v_min := v_s[1];
  FOR v_i IN 1..16 LOOP
    v_total := v_total + v_s[v_i];
    IF v_s[v_i] > v_max THEN v_max := v_s[v_i]; END IF;
    IF v_s[v_i] < v_min THEN v_min := v_s[v_i]; END IF;
  END LOOP;

  IF v_total > 0 AND v_max <> v_min THEN
    v_target := v_total * v_round.rtp_percentage / 1400.0;   -- rho * T / 14
    v_mean   := v_total / 16.0;
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
  IF v_lambda > 0 AND public.lucky16_random_int(1000000) < v_lambda * 1000000 THEN
    FOR v_i IN 1..16 LOOP
      IF v_s[v_i] = v_ext THEN v_n_ext := v_n_ext + 1; END IF;
    END LOOP;
    v_k := public.lucky16_random_int(v_n_ext);
    FOR v_i IN 1..16 LOOP
      IF v_s[v_i] = v_ext THEN
        IF v_k = 0 THEN v_idx := v_i; EXIT; END IF;
        v_k := v_k - 1;
      END IF;
    END LOOP;
  ELSE
    v_idx := public.lucky16_random_int(16) + 1;
  END IF;

  v_rank := v_ranks[(v_idx - 1) / 4 + 1];
  v_suit := v_suits[(v_idx - 1) % 4 + 1];

  UPDATE public.lucky16_rounds
     SET winning_rank = v_rank, winning_suit = v_suit,
         phase = 'drawing', total_stake = v_total, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('winning_rank', v_rank, 'winning_suit', v_suit,
                            'total_stake', v_total);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- lucky16_settle_round
-- ---------------------------------------------------------------------------
-- Pays one batch of a drawn round. Locks the round row, so concurrent callers
-- serialise; a settled round returns at once. Writes balances and ledger rows
-- directly in one statement, exactly as lucky_card_settle_round and
-- spin2win_settle_round do (batch settlement, Issue #34), tagging each ledger
-- row with lucky16_round_id.
CREATE FUNCTION public.lucky16_settle_round(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_round       public.lucky16_rounds;
  v_card        TEXT;
  v_batch_size  INT;
  v_batch_count INT;
  v_batch_paid  BIGINT;
BEGIN
  SELECT settle_batch_size INTO v_batch_size FROM public.lucky16_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.lucky16_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.winning_rank IS NULL THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'not_drawn');
  END IF;

  IF v_round.phase = 'settled' THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'already_settled');
  END IF;

  -- The winning card's column name, for example 'a_hearts' or 'k_clubs'.
  v_card := lower(v_round.winning_rank) || '_' || v_round.winning_suit;

  WITH batch AS (
    SELECT id,
           CASE v_card
             WHEN 'a_hearts'   THEN a_hearts   WHEN 'a_spades' THEN a_spades
             WHEN 'a_diamonds' THEN a_diamonds WHEN 'a_clubs'  THEN a_clubs
             WHEN 'j_hearts'   THEN j_hearts   WHEN 'j_spades' THEN j_spades
             WHEN 'j_diamonds' THEN j_diamonds WHEN 'j_clubs'  THEN j_clubs
             WHEN 'q_hearts'   THEN q_hearts   WHEN 'q_spades' THEN q_spades
             WHEN 'q_diamonds' THEN q_diamonds WHEN 'q_clubs'  THEN q_clubs
             WHEN 'k_hearts'   THEN k_hearts   WHEN 'k_spades' THEN k_spades
             WHEN 'k_diamonds' THEN k_diamonds WHEN 'k_clubs'  THEN k_clubs
           END AS win_stake
      FROM public.lucky16_bets
     WHERE round_id = p_round_id AND NOT is_settled
     ORDER BY id
     LIMIT v_batch_size
     FOR UPDATE
  ),
  computed AS (
    SELECT id, (win_stake * 14 * v_round.bonus_multiplier)::BIGINT AS pay
      FROM batch
  ),
  scored AS (
    UPDATE public.lucky16_bets b
       SET total_payout = computed.pay,
           is_settled   = true,
           settled_at   = NOW()
      FROM computed
     WHERE b.id = computed.id
    RETURNING b.user_id, computed.pay AS total_payout
  ),
  winners AS (
    SELECT user_id, total_payout FROM scored WHERE total_payout > 0
  ),
  paid AS (
    UPDATE public.profiles p
       SET coin_balance   = p.coin_balance + winners.total_payout,
           ledger_version = p.ledger_version + 1,
           updated_at     = NOW()
      FROM winners
     WHERE p.id = winners.user_id
    RETURNING p.id AS user_id, p.coin_balance AS new_balance, winners.total_payout
  ),
  ledgered AS (
    INSERT INTO public.coin_ledger (user_id, counterparty_id, kind, amount, balance_after, lucky16_round_id)
    SELECT user_id, NULL, 'payout', total_payout, new_balance, p_round_id
      FROM paid
    RETURNING amount
  )
  SELECT (SELECT count(*) FROM scored),
         COALESCE((SELECT sum(amount) FROM ledgered), 0)
    INTO v_batch_count, v_batch_paid;

  UPDATE public.lucky16_rounds
     SET total_payout = total_payout + v_batch_paid,
         phase        = CASE WHEN v_batch_count < v_batch_size THEN 'settled' ELSE phase END,
         settled_at   = CASE WHEN v_batch_count < v_batch_size THEN NOW() ELSE settled_at END
   WHERE id = p_round_id;

  RETURN jsonb_build_object(
    'settled',       v_batch_count,
    'paid',          v_batch_paid,
    'fully_settled', (v_batch_count < v_batch_size)
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES - internal functions, service_role only.
-- ---------------------------------------------------------------------------
-- Default privileges grant EXECUTE on every new function to anon and
-- authenticated (Issue #120). A client must never be able to force a draw or
-- a settlement; these match the live ACL of the other games' twins:
-- {postgres, service_role}. CREATE OR REPLACE keeps these grants; DROP +
-- CREATE would re-open them.
REVOKE ALL ON FUNCTION public.lucky16_random_int(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lucky16_draw_round(UUID)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lucky16_settle_round(UUID)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lucky16_random_int(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.lucky16_draw_round(UUID)    TO service_role;
GRANT EXECUTE ON FUNCTION public.lucky16_settle_round(UUID)  TO service_role;

COMMENT ON FUNCTION public.lucky16_random_int(INTEGER) IS
  'Unbiased random integer in [0, n) from 4 random bytes with rejection '
  'sampling. Internal to Lucky 16 Card; service_role only.';
COMMENT ON FUNCTION public.lucky16_draw_round(UUID) IS
  'Draws the winning card (A/J/Q/K of a suit) for one Lucky 16 Card round, '
  'once, under a row lock. Weighted random: the average payout equals the '
  'round''s pinned RTP; at 87.5% it is a fair draw. Does not pay anyone and '
  'ignores the bonus; settlement does both. Internal; service_role only.';
COMMENT ON FUNCTION public.lucky16_settle_round(UUID) IS
  'Pays one batch of a drawn Lucky 16 Card round: stake on the winning card x '
  '14 x the round''s pinned bonus (1 = N). Writes balances and coin_ledger rows '
  '(lucky16_round_id) together; marks the round settled when a batch comes '
  'back short. Idempotent. Internal; service_role only.';

COMMIT;
