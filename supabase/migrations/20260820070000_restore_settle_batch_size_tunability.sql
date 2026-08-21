-- Issue #47 RE-FIX: restores settle_round()'s batch size to being read live
-- from game_config.settle_batch_size, instead of the hardcoded CONSTANT it
-- had silently regressed back to.
--
-- History: Issue #47 (2026-08-08) made this genuinely tunable -- a plain
-- UPDATE could change it, no code deploy needed. Issue #89's later rewrite
-- (20260819040000_permanent_payout_multipliers.sql), done for a completely
-- unrelated reason (hardcoding the x9/x90/x900 payout rates), used
-- CREATE OR REPLACE FUNCTION starting from an older copy of settle_round's
-- body that predated the #47 fix -- silently bringing back the hardcoded
-- CONSTANT 3000, even though game_config.settle_batch_size still sat there,
-- unused, looking like it was still in effect. This migration is a surgical
-- diff against the CURRENT live function (fetched fresh via
-- pg_get_functiondef immediately before writing this file, not
-- reconstructed from memory or an old migration file) -- only the batch
-- size declaration changes; the x9/x90/x900 literals and every other line
-- are byte-for-byte unchanged, specifically to avoid repeating the exact
-- mistake that caused this regression.
--
-- Also raises the default from 3000 to 10000, based on a live benchmark
-- (temp-table, server-side, no client round-trip) against this production
-- database: at 50,000 winners, a single 10,000-row batch keeps worst-case
-- lock duration to ~227ms (vs. ~928ms for one unbounded batch) while adding
-- only ~5% total completion time versus doing it all in one shot -- a
-- better time/lock-duration trade-off than the old 3000 default.

BEGIN;

CREATE OR REPLACE FUNCTION public.settle_round(p_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round        public.rounds;
  v_s_key        TEXT; v_d_key TEXT; v_t_key TEXT;
  v_batch_size   INT;
  v_batch_count  INT;
  v_batch_paid   BIGINT;
BEGIN
  -- Issue #47 RE-FIX: read live instead of a hardcoded CONSTANT, so this
  -- can be tuned with a plain UPDATE, no deploy needed -- the property that
  -- was silently lost when this function was last replaced for an
  -- unrelated reason (Issue #89).
  SELECT settle_batch_size INTO v_batch_size FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.red IS NULL THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'not_drawn');
  END IF;

  IF v_round.phase = 'settled' THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'already_settled');
  END IF;

  -- One canonical key form, computed once per call (not per bet) -- the
  -- round's winning digits are fixed for its whole settlement.
  v_s_key := v_round.black::TEXT;
  v_d_key := v_round.green::TEXT || v_round.black::TEXT;
  v_t_key := v_round.red::TEXT || v_round.green::TEXT || v_round.black::TEXT;

  WITH batch AS (
    -- Step 1a: grab a bounded slice of still-unsettled bets for this round.
    SELECT id, single_bets, double_bets, triple_bets
      FROM public.bets
     WHERE round_id = p_round_id AND NOT is_settled
     ORDER BY id
     LIMIT v_batch_size
     FOR UPDATE
  ),
  computed AS (
    -- Step 1b: work out each bet's payout ONCE -- reused below for both the
    -- bets-table write and the total, never recomputed a second time.
    -- Payout multiplier is permanent (x9/x90/x900) -- the same literal
    -- draw_round targets against, so the two can never disagree again.
    SELECT
      id,
      (COALESCE((single_bets ->> v_s_key)::BIGINT, 0) * 9)::BIGINT AS s_pay,
      (COALESCE((double_bets ->> v_d_key)::BIGINT, 0) * 90)::BIGINT AS d_pay,
      (COALESCE((triple_bets ->> v_t_key)::BIGINT, 0) * 900)::BIGINT AS t_pay
    FROM batch
  ),
  scored AS (
    -- Step 1c: record every bet's outcome -- winners and losers alike.
    -- Nobody's balance is touched here yet.
    UPDATE public.bets b
       SET single_payout = computed.s_pay,
           double_payout  = computed.d_pay,
           triple_payout  = computed.t_pay,
           total_payout   = computed.s_pay + computed.d_pay + computed.t_pay,
           is_settled     = true,
           settled_at     = NOW()
      FROM computed
     WHERE b.id = computed.id
    RETURNING b.id, b.user_id, (computed.s_pay + computed.d_pay + computed.t_pay) AS total_payout
  ),
  winners AS (
    -- Step 2a: keep only actual winners. Losers (total_payout = 0) never
    -- reach the money-moving or ledger steps below.
    SELECT id AS bet_id, user_id, total_payout
      FROM scored
     WHERE total_payout > 0
  ),
  paid AS (
    -- Step 2b: pay every winner in one bulk update. Safe 1:1 join --
    -- bets_one_per_round guarantees one bet row per player per round.
    UPDATE public.profiles p
       SET coin_balance   = p.coin_balance + winners.total_payout,
           ledger_version = p.ledger_version + 1,
           updated_at     = NOW()
      FROM winners
     WHERE p.id = winners.user_id
    RETURNING p.id AS user_id, p.coin_balance AS new_balance, winners.total_payout, winners.bet_id
  ),
  ledgered AS (
    -- Step 3: write each winner's receipt using the EXACT balance `paid`
    -- just wrote -- never a second, independently recalculated number.
    INSERT INTO public.coin_ledger (user_id, counterparty_id, kind, amount, balance_after, round_id)
    SELECT user_id, NULL, 'payout', total_payout, new_balance, p_round_id
      FROM paid
    RETURNING amount
  )
  SELECT
    (SELECT count(*) FROM scored),
    COALESCE((SELECT sum(amount) FROM ledgered), 0)
    INTO v_batch_count, v_batch_paid;

  -- Step 4: this call's share of the round's running total, and -- only if
  -- this batch turned out smaller than the limit, meaning nothing was left
  -- to grab -- mark the round fully settled. A full batch leaves phase
  -- untouched, so the next call (another player's poll, or the scheduler's
  -- next tick) continues exactly where this one stopped.
  UPDATE public.rounds
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
$function$;

-- Raise the default from 3000 to 10000 (see header comment for the
-- benchmark rationale). Still within the column's existing safety bound
-- (CHECK 1-20000), no constraint change needed.
UPDATE public.game_config SET settle_batch_size = 10000 WHERE id = 'global';

COMMIT;
