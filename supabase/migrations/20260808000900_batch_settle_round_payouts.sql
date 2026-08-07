-- Payout-settlement scalability fix, raised by the user while discussing
-- Issue #4's amendment: "settle_round pays winners one at a time in a loop --
-- what happens at 5,000+ concurrent players, worse at 100,000?"
--
-- Root cause, confirmed by reading the live code: settle_round() loops over
-- every winning bet and calls apply_coin_movement() once per winner --
-- three separate statements (lock the account, update the balance, insert the
-- ledger row) executed sequentially, one winner after another. At a few
-- hundred winners this is survivable; at thousands it is not -- rough
-- estimate, tens of minutes at 80,000 sequential winners, almost certainly
-- exceeding any request timeout and holding locks open the entire time.
--
-- Fix: replace the per-winner loop with set-based SQL -- the exact same
-- payout formula, evaluated for many rows in one statement instead of one row
-- at a time. Bounded to a fixed-size batch per call (was originally drafted
-- as one internal loop processing every batch in a single call, then
-- corrected: a single PL/pgSQL function call is still one transaction, so an
-- internal loop would NOT have given batch-level crash safety -- if it failed
-- partway, every batch in that same call would roll back together, not just
-- the unfinished one).
--
-- Processing exactly one bounded batch per call, and relying on being called
-- again to finish a large round, mirrors the pattern this codebase already
-- uses and trusts: tick_rounds() (20260807120000_round_scheduler.sql) already
-- does `LIMIT 20` rounds per run for the identical reason ("a large backlog
-- drains over successive ticks... rather than stalling one very long
-- transaction"). This applies the same principle one level deeper, to bets
-- within a single round, instead of only across rounds.
--
-- Correctness guarantees preserved from the original row-by-row version:
--   * `WHERE round_id = p_round_id AND NOT is_settled` is unchanged -- a
--     round already fully settled is untouched by a repeat call (idempotent,
--     never double-pays).
--   * Losers (total_payout = 0) are scored and marked settled by the first
--     part of the statement, but never enter the winners/paid/ledgered CTEs --
--     avoiding an attempted zero-amount coin_ledger insert, which the
--     database's own `amount <> 0` CHECK constraint would otherwise reject
--     outright.
--   * Each winner's coin_ledger row is written directly from the balance
--     UPDATE's own RETURNING output (the `paid` CTE feeds `ledgered`
--     directly) -- never a second, independently recalculated balance that
--     could disagree with what was actually written.
--   * total_payout on each bet is computed once (in the `computed` CTE) and
--     reused, rather than being recomputed as a second, potentially-diverging
--     expression.
--   * A player can only have one bet row per round (bets_one_per_round
--     UNIQUE constraint), so the profiles join is a plain one-to-one match --
--     no grouping/summing across rows, no risk of one player's winnings
--     merging with another's.
--
-- apply_coin_movement() itself is untouched. It is still used as-is by
-- agent_transfer_coins, admin_issue_coins, and place_bet's stake deduction --
-- all single-player operations by nature, none of which have this scaling
-- problem.
--
-- See bsg_web_dashboard/scripts/verify_settle_round_batching.sql for the
-- manual verification script (fixture test, reconciliation query, batching
-- and idempotency checks) to run before relying on this in production.

CREATE OR REPLACE FUNCTION public.settle_round(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round        public.rounds;
  v_cfg          public.game_config;
  v_s_key        TEXT; v_d_key TEXT; v_t_key TEXT;
  v_batch_size   CONSTANT INT := 3000;
  v_batch_count  INT;
  v_batch_paid   BIGINT;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.red IS NULL THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'not_drawn');
  END IF;

  IF v_round.phase = 'settled' THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'already_settled');
  END IF;

  SELECT * INTO v_cfg FROM public.game_config WHERE id = 'global';

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
    SELECT
      id,
      (COALESCE((single_bets ->> v_s_key)::BIGINT, 0) * v_cfg.payout_multiplier_single)::BIGINT AS s_pay,
      (COALESCE((double_bets ->> v_d_key)::BIGINT, 0) * v_cfg.payout_multiplier_double)::BIGINT AS d_pay,
      (COALESCE((triple_bets ->> v_t_key)::BIGINT, 0) * v_cfg.payout_multiplier_triple)::BIGINT AS t_pay
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
$$;
