-- ============================================================================
-- Make the payout multiplier (single x9 / double x90 / triple x900)
-- permanent -- no longer configurable anywhere, by explicit product decision.
--
-- CONTEXT
--
-- Issue #5/#43 previously moved this value into game_config, pinned per-round
-- onto `rounds`, and exposed it via a superadmin dashboard widget. Re-auditing
-- that work live (2026-08-19) found the production database had silently
-- drifted from its own migration history -- draw_round correctly read the
-- round's pinned value, but the LIVE settle_round (the function that actually
-- pays real coins) still read straight from game_config, unpinned. The two
-- migrations meant to fix this (20260808001000, 20260808001200) exist
-- correctly on disk but were never actually applied to production; the live
-- function matched an even earlier version. Confirmed via pg_get_functiondef,
-- not assumed.
--
-- Rather than re-deploy the "configurable but consistent" design, the product
-- decision (2026-08-19) is that this rate is permanent and should never be
-- editable again -- eliminating the entire class of bug (an editable value
-- that draw and settle could read inconsistently) rather than re-fixing the
-- read-consistency of a value that shouldn't be editable in the first place.
--
-- FIX
--
-- draw_round, settle_round, and get_play_limits now use the literals 9/90/900
-- directly -- no config table, no per-round pinning, nothing left to drift.
-- get_current_round/tick_rounds stop reading/writing the now-removed columns
-- (their rtp_percentage handling is untouched -- RTP stays a separate,
-- genuinely-still-configurable value via the RTP Configuration widget, not
-- part of this change). game_config.payout_multiplier_* and
-- rounds.payout_multiplier_* are dropped as confirmed-dead columns (verified
-- live: referenced by no view, trigger, index, or other function beyond the
-- five rewritten here).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.draw_round(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round        public.rounds;
  v_stake        BIGINT := 0;
  v_target       NUMERIC;
  v_s            BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[10]);
  v_d            BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[100]);
  v_t            BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[1000]);
  v_bet          RECORD;
  v_k            TEXT;
  v_v            BIGINT;
  v_r INT; v_g INT; v_b INT;
  v_payout       NUMERIC;
  v_diff         NUMERIC;
  v_best_diff    NUMERIC := NULL;
  v_tied_count   INT := 0;
  v_best_r INT := 0; v_best_g INT := 0; v_best_b INT := 0;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.red IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true,
      'red', v_round.red, 'green', v_round.green, 'black', v_round.black);
  END IF;

  FOR v_bet IN SELECT single_bets, double_bets, triple_bets, total_stake
                 FROM public.bets WHERE round_id = p_round_id
  LOOP
    v_stake := v_stake + v_bet.total_stake;
    FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(v_bet.single_bets) LOOP
      v_s[v_k::INT + 1] := v_s[v_k::INT + 1] + v_v;
    END LOOP;
    FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(v_bet.double_bets) LOOP
      v_d[v_k::INT + 1] := v_d[v_k::INT + 1] + v_v;
    END LOOP;
    FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(v_bet.triple_bets) LOOP
      v_t[v_k::INT + 1] := v_t[v_k::INT + 1] + v_v;
    END LOOP;
  END LOOP;

  IF v_stake > 0 THEN
    v_target := v_stake * (v_round.rtp_percentage / 100.0);
    FOR v_r IN 0..9 LOOP
      FOR v_g IN 0..9 LOOP
        FOR v_b IN 0..9 LOOP
          -- Payout multiplier is permanent (single x9 / double x90 / triple
          -- x900) -- no longer read from anywhere, never configurable again.
          v_payout := (v_s[v_b + 1] * 9.0)
                    + (v_d[(v_g * 10 + v_b) + 1] * 90.0)
                    + (v_t[(v_r * 100 + v_g * 10 + v_b) + 1] * 900.0);
          v_diff := abs(v_payout - v_target);

          IF v_best_diff IS NULL OR v_diff < v_best_diff THEN
            v_best_diff  := v_diff;
            v_tied_count := 1;
            v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
          ELSIF v_diff = v_best_diff THEN
            v_tied_count := v_tied_count + 1;
            IF public.random_index_unbiased(v_tied_count) = 0 THEN
              v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  ELSE
    v_best_r := public.random_digit_unbiased();
    v_best_g := public.random_digit_unbiased();
    v_best_b := public.random_digit_unbiased();
  END IF;

  UPDATE public.rounds
     SET red = v_best_r, green = v_best_g, black = v_best_b,
         phase = 'drawing', total_stake = v_stake, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('red', v_best_r, 'green', v_best_g, 'black', v_best_b,
                            'total_stake', v_stake);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_round(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round        public.rounds;
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
$$;

CREATE OR REPLACE FUNCTION public.get_play_limits()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE v public.play_limits;
BEGIN
  SELECT * INTO v FROM public.play_limits WHERE id = 'global';
  -- Payout multiplier is permanent -- returned as a literal so the app's
  -- existing 'multiplier' field in this response keeps working unchanged,
  -- with no client-side release required for this change.
  RETURN jsonb_build_object(
    'single', jsonb_build_object('min', v.single_min, 'max', v.single_max, 'multiplier', 9),
    'double', jsonb_build_object('min', v.double_min, 'max', v.double_max, 'multiplier', 90),
    'triple', jsonb_build_object('min', v.triple_min, 'max', v.triple_max, 'multiplier', 900)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_round()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle    CONSTANT INT := 103;
  v_now      BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_number   BIGINT := v_now / v_cycle;
  v_into     INT    := (v_now % v_cycle)::INT;
  v_left     INT    := v_cycle - (v_now % v_cycle)::INT;
  v_draw_at  INT;
  v_rtp      NUMERIC;
  v_round    public.rounds;
BEGIN
  SELECT draw_at_second, rtp_percentage
    INTO v_draw_at, v_rtp
    FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting', v_rtp)
    ON CONFLICT (round_number) DO NOTHING;
    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  IF v_into >= v_draw_at THEN
    -- Issue #14 fix: a failure here must never propagate to the caller --
    -- every connected player's device calls this function every 2 seconds,
    -- so an uncaught exception here is what was causing a mass forced
    -- logout across every active player, not just whoever bet on the
    -- broken round.
    BEGIN
      IF v_round.red IS NULL THEN
        PERFORM public.draw_round(v_round.id);
      END IF;
      PERFORM public.settle_round(v_round.id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_log (actor_id, kind, detail)
      VALUES (NULL, 'system',
        format('get_current_round: round %s failed to draw/settle: %s', v_round.id, SQLERRM));
    END;
    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  RETURN jsonb_build_object(
    'round_id',          v_round.id,
    'round_number',      v_round.round_number,
    'phase',             v_round.phase,
    'scheduled_at',      v_round.scheduled_at,
    'seconds_remaining', v_left,
    'seconds_into',      v_into,
    'draw_at_second',    v_draw_at,
    'red',               v_round.red,
    'green',             v_round.green,
    'black',             v_round.black
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tick_rounds()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle    CONSTANT INT := 103;
  v_now      BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_current  BIGINT := v_now / v_cycle;
  v_into     INT    := (v_now % v_cycle)::INT;
  v_draw_at  INT;
  v_rtp      NUMERIC;
  v_r        RECORD;
  v_drawn    INT := 0;
  v_settled  INT := 0;
  v_failed   INT := 0;
BEGIN
  SELECT draw_at_second, rtp_percentage
    INTO v_draw_at, v_rtp
    FROM public.game_config WHERE id = 'global';

  -- Create the current round even when nobody is online, so the round history
  -- stays continuous instead of gapping whenever no player is connected.
  INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage)
  VALUES (v_current, to_timestamp((v_current + 1) * v_cycle), 'betting', v_rtp)
  ON CONFLICT (round_number) DO NOTHING;

  -- Every round whose draw time has passed and which is not yet fully settled.
  -- Covers both the steady state (the round just now reaching T+94) and any
  -- backlog left by an outage.
  --
  -- LIMIT 20 bounds the work per tick. A large backlog drains over successive
  -- ticks a few seconds apart rather than stalling one very long transaction;
  -- draw_round scans all 1,000 combinations per round, so an unbounded catch-up
  -- after a long outage could otherwise run for minutes while holding locks.
  FOR v_r IN
    SELECT id, red
      FROM public.rounds
     WHERE (round_number < v_current
            OR (round_number = v_current AND v_into >= v_draw_at))
       AND (red IS NULL OR phase <> 'settled')
     ORDER BY round_number
     LIMIT 20
  LOOP
    -- Issue #14 fix: one bad round must not abort the whole batch. Before
    -- this, an exception here rolled back every other round already
    -- processed in this same tick and retried the identical failure every
    -- 10 seconds forever, with no log trail anywhere.
    BEGIN
      -- Both are idempotent: draw_round returns already_drawn when red is
      -- set, settle_round returns not_drawn when it is not, and only ever
      -- touches bets with is_settled = false.
      IF v_r.red IS NULL THEN
        PERFORM public.draw_round(v_r.id);
        v_drawn := v_drawn + 1;
      END IF;
      PERFORM public.settle_round(v_r.id);
      v_settled := v_settled + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.audit_log (actor_id, kind, detail)
      VALUES (NULL, 'system',
        format('tick_rounds: round %s failed to draw/settle: %s', v_r.id, SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'round_number', v_current,
    'seconds_into', v_into,
    'drawn',        v_drawn,
    'settled',      v_settled,
    'failed',       v_failed
  );
END;
$$;

-- Now-dead columns: nothing reads or writes payout_multiplier_* anywhere
-- (verified live: the five functions above are the only references in the
-- whole database; no view, trigger, or index touches them). Their own CHECK
-- constraints drop automatically with the columns.
ALTER TABLE public.rounds
  DROP COLUMN payout_multiplier_single,
  DROP COLUMN payout_multiplier_double,
  DROP COLUMN payout_multiplier_triple;

ALTER TABLE public.game_config
  DROP COLUMN payout_multiplier_single,
  DROP COLUMN payout_multiplier_double,
  DROP COLUMN payout_multiplier_triple;

COMMIT;
