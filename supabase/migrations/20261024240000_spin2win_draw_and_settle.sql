-- #############################################################################
-- SPIN2WIN - STEP 5: THE DRAW AND THE SETTLEMENT
-- Migration: 20261024240000_spin2win_draw_and_settle.sql
-- Plan: /spin2win/SPIN2WIN_BUILD_PLAN.md step 5, decision D1 option A
-- #############################################################################
--
-- PURELY ADDITIVE. Creates three new functions:
--   spin2win_random_int(n)        unbiased random integer in [0, n)
--   spin2win_draw_round(round)    picks the winning number for one round
--   spin2win_settle_round(round)  pays the winners of one drawn round
-- Nothing belonging to Triple Chance or Lucky Card is altered, dropped,
-- replaced or CALLED: lucky_card_random_int / lucky_card_draw_round /
-- lucky_card_settle_round and draw_round / settle_round are untouched and
-- unused. Spin2Win has its own copies so it can never depend on, or break,
-- another game's function.
--
-- THE DRAW (decision D1 A: the Lucky Card weighted-random rule)
-- ------------------------------------------------------------
-- s[k]  = total staked on number k by all players in the round (k = 0..9)
-- T     = sum of s[k]
-- rho   = the round's own pinned rtp_percentage / 100
--
--   1. T = 0            -> uniform over the 10 numbers.
--   2. target = rho*T/9    (the stake the winning number must carry on average
--                           for the payout, 9 x that stake, to average rho*T)
--      mean   = T/10       (what a fair draw gives)
--   3. target > mean    -> s_ext = the highest stake on any number
--      target < mean    -> s_ext = the lowest stake on any number
--      target = mean, or all 10 stakes equal -> uniform.
--   4. lambda = min(1, |target - mean| / |s_ext - mean|)
--   5. with probability lambda: uniform among the numbers whose stake = s_ext
--      otherwise:               uniform among all 10 numbers
--
-- Average payout = 9 * ((1-lambda)*mean + lambda*s_ext) = rho*T whenever
-- lambda is not clamped. At rho = 90% lambda is 0 and the draw is exactly
-- fair. The bonus multiplier is deliberately NOT part of the draw; as in the
-- other two games it is applied only at settlement, as extra payout.
--
-- THE SETTLEMENT
-- --------------
-- payout = stake on the winning number x 9 x the round's pinned bonus
-- (bonus 1 = N). Example: 5 on number 2, result 2 -> N 45, 2x 90, 3x 135,
-- 4x 180 (user's own example, 2026-10-24). The stake was already taken when
-- the bet was placed, so the payout is what the balance goes up by.
-- Same batched shape as lucky_card_settle_round (live definition read
-- 2026-10-24): settle_batch_size bets per call, one ledger row per winner,
-- round marked settled when a batch comes back short. Idempotent.
--
-- ERROR CODES: P0120 (round not found) is reused, as Lucky Card does.
-- P0127 is new (spin2win_random_int range); verified free 2026-10-24.
-- #############################################################################

BEGIN;

-- ---------------------------------------------------------------------------
-- spin2win_random_int
-- ---------------------------------------------------------------------------
-- Unbiased integer in [0, p_n), from 4 cryptographically random bytes with
-- rejection sampling. A copy of lucky_card_random_int, kept separate so the
-- two games never share a function.
CREATE FUNCTION public.spin2win_random_int(p_n INTEGER)
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
    RAISE EXCEPTION 'spin2win_random_int: range must be 1..1000000000' USING errcode = 'P0127';
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
-- spin2win_draw_round
-- ---------------------------------------------------------------------------
-- Draws the winning number for one round, once, under a row lock (a second
-- caller finds it set and gets it back unchanged). Sets phase = 'drawing',
-- the pooled stake and drawn_at. Paying is spin2win_settle_round's job.
--
-- Weighted random draw (decision D1 A, same rule as lucky_card_draw_round):
--   s[k] = pooled stake on number k (k = 0..9), T = sum, rho = RTP / 100
--   target = rho*T/9 (stake the winner must carry for 9x payout to average rho*T)
--   mean   = T/10
--   target > mean -> s_ext = max stake; target < mean -> s_ext = min stake
--   lambda = min(1, |target-mean| / |s_ext-mean|)
--   with prob lambda pick uniformly among numbers with stake s_ext, else uniform over 10.
-- At rho = 90% target = mean, lambda = 0: exactly fair. Bonus ignored here
-- (applied at settlement as extra payout).
CREATE FUNCTION public.spin2win_draw_round(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_round   public.spin2win_rounds;
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
  v_number  SMALLINT;
BEGIN
  SELECT * INTO v_round FROM public.spin2win_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.winning_number IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true, 'winning_number', v_round.winning_number);
  END IF;

  -- Array index i (1..10) holds number i-1.
  SELECT ARRAY[
           COALESCE(sum(n0),0), COALESCE(sum(n1),0), COALESCE(sum(n2),0), COALESCE(sum(n3),0), COALESCE(sum(n4),0),
           COALESCE(sum(n5),0), COALESCE(sum(n6),0), COALESCE(sum(n7),0), COALESCE(sum(n8),0), COALESCE(sum(n9),0)
         ]::BIGINT[]
    INTO v_s
    FROM public.spin2win_bets
   WHERE round_id = p_round_id;

  v_max := v_s[1];
  v_min := v_s[1];
  FOR v_i IN 1..10 LOOP
    v_total := v_total + v_s[v_i];
    IF v_s[v_i] > v_max THEN v_max := v_s[v_i]; END IF;
    IF v_s[v_i] < v_min THEN v_min := v_s[v_i]; END IF;
  END LOOP;

  IF v_total > 0 AND v_max <> v_min THEN
    v_target := v_total * v_round.rtp_percentage / 900.0;   -- rho * T / 9
    v_mean   := v_total / 10.0;
    IF v_target > v_mean THEN
      v_ext := v_max;
    ELSIF v_target < v_mean THEN
      v_ext := v_min;
    END IF;
    IF v_ext IS NOT NULL THEN
      v_lambda := LEAST(1.0, abs(v_target - v_mean) / abs(v_ext - v_mean));
    END IF;
  END IF;

  IF v_lambda > 0 AND public.spin2win_random_int(1000000) < v_lambda * 1000000 THEN
    FOR v_i IN 1..10 LOOP
      IF v_s[v_i] = v_ext THEN v_n_ext := v_n_ext + 1; END IF;
    END LOOP;
    v_k := public.spin2win_random_int(v_n_ext);
    FOR v_i IN 1..10 LOOP
      IF v_s[v_i] = v_ext THEN
        IF v_k = 0 THEN v_idx := v_i; EXIT; END IF;
        v_k := v_k - 1;
      END IF;
    END LOOP;
  ELSE
    v_idx := public.spin2win_random_int(10) + 1;
  END IF;

  v_number := (v_idx - 1)::SMALLINT;

  UPDATE public.spin2win_rounds
     SET winning_number = v_number,
         phase = 'drawing', total_stake = v_total, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('winning_number', v_number, 'total_stake', v_total);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- spin2win_settle_round
-- ---------------------------------------------------------------------------
-- Pays one batch of a drawn round. Locks the round row, so concurrent callers
-- serialise; a settled round returns at once. Writes balances and ledger rows
-- directly in one statement, exactly as lucky_card_settle_round and
-- settle_round do (batch settlement, Issue #34), tagging each ledger row with
-- spin2win_round_id.
CREATE FUNCTION public.spin2win_settle_round(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_round       public.spin2win_rounds;
  v_batch_size  INT;
  v_batch_count INT;
  v_batch_paid  BIGINT;
BEGIN
  SELECT settle_batch_size INTO v_batch_size FROM public.spin2win_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.spin2win_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.winning_number IS NULL THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'not_drawn');
  END IF;

  IF v_round.phase = 'settled' THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'already_settled');
  END IF;

  WITH batch AS (
    SELECT id,
           CASE v_round.winning_number
             WHEN 0 THEN n0 WHEN 1 THEN n1 WHEN 2 THEN n2 WHEN 3 THEN n3 WHEN 4 THEN n4
             WHEN 5 THEN n5 WHEN 6 THEN n6 WHEN 7 THEN n7 WHEN 8 THEN n8 WHEN 9 THEN n9
           END AS win_stake
      FROM public.spin2win_bets
     WHERE round_id = p_round_id AND NOT is_settled
     ORDER BY id
     LIMIT v_batch_size
     FOR UPDATE
  ),
  computed AS (
    SELECT id, (win_stake * 9 * v_round.bonus_multiplier)::BIGINT AS pay
      FROM batch
  ),
  scored AS (
    UPDATE public.spin2win_bets b
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
    INSERT INTO public.coin_ledger (user_id, counterparty_id, kind, amount, balance_after, spin2win_round_id)
    SELECT user_id, NULL, 'payout', total_payout, new_balance, p_round_id
      FROM paid
    RETURNING amount
  )
  SELECT (SELECT count(*) FROM scored),
         COALESCE((SELECT sum(amount) FROM ledgered), 0)
    INTO v_batch_count, v_batch_paid;

  UPDATE public.spin2win_rounds
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
-- a settlement; these match the live ACL of the Lucky Card twins:
-- {postgres, service_role}. CREATE OR REPLACE keeps these grants; DROP +
-- CREATE would re-open them.
REVOKE ALL ON FUNCTION public.spin2win_random_int(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spin2win_draw_round(UUID)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spin2win_settle_round(UUID)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spin2win_random_int(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.spin2win_draw_round(UUID)    TO service_role;
GRANT EXECUTE ON FUNCTION public.spin2win_settle_round(UUID)  TO service_role;

COMMENT ON FUNCTION public.spin2win_random_int(INTEGER) IS
  'Unbiased random integer in [0, n) from 4 random bytes with rejection '
  'sampling. Internal to Spin2Win; service_role only.';
COMMENT ON FUNCTION public.spin2win_draw_round(UUID) IS
  'Draws the winning number (0-9) for one Spin2Win round, once, under a row '
  'lock. Weighted random: the average payout equals the round''s pinned RTP; '
  'at 90% it is a fair draw. Does not pay anyone and ignores the bonus; '
  'settlement does both. Internal; service_role only.';
COMMENT ON FUNCTION public.spin2win_settle_round(UUID) IS
  'Pays one batch of a drawn Spin2Win round: stake on the winning number x 9 '
  'x the round''s pinned bonus (1 = N). Writes balances and coin_ledger rows '
  '(spin2win_round_id) together; marks the round settled when a batch comes '
  'back short. Idempotent. Internal; service_role only.';

COMMIT;
