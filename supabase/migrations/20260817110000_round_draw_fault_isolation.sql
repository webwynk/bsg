-- Fix (Issue #14, expanded scope): neither get_current_round() nor
-- tick_rounds() had any fault isolation around their draw_round/settle_round
-- calls. Confirmed exhaustively live: these are the ONLY two functions in
-- the whole database that ever call draw_round/settle_round.
--
-- ROOT CAUSE, full picture (traced end-to-end before writing this fix)
--
-- get_current_round() is polled by every connected player's device every 2
-- seconds (RoundSyncService._pollTimer), and additionally by the dedicated
-- spin-delivery fetch at the top of every round (up to 8 rapid retries).
-- Both call this same function. If a round's draw_round/settle_round call
-- ever throws (malformed bet data, a transient lock/connectivity blip --
-- confirmed via code reading these are the only realistic triggers, and
-- confirmed via live data that this has never actually happened on this
-- platform), the exception propagates straight out of get_current_round()
-- as a hard failure. The app's own poller (round_sync_service.dart) treats
-- 3 consecutive failures (~6s) as "connection lost" and force-logs out
-- EVERY currently-connected player, not just whoever bet on the broken
-- round -- with a message that wrongly blames their own connectivity.
--
-- tick_rounds() (the pg_cron background catch-up job, every 10s) has the
-- identical gap: one bad round aborts its whole transaction, silently
-- rolling back any other rounds already processed in that same tick, and
-- retries the identical failure forever with no log trail anywhere.
--
-- FIX
--
-- Both functions now wrap their draw/settle attempt in BEGIN...EXCEPTION,
-- so a single round's failure is caught, logged to audit_log (kind =
-- 'system', already surfaced by the existing superadmin "Recent System
-- Logs" widget with zero dashboard code changes needed -- confirmed live),
-- and the round is left as still-in-progress rather than the failure
-- propagating. get_current_round() returns the round's current state
-- gracefully (red/green/black stay null) instead of throwing -- the app's
-- poller sees a normal successful response, not a hard failure, so the
-- mass-logout cascade never triggers. tick_rounds() skips the bad round and
-- keeps processing the rest of its batch.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_current_round()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle    CONSTANT INT := 103;
  v_now      BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_number   BIGINT := v_now / v_cycle;
  v_into     INT    := (v_now % v_cycle)::INT;
  v_left     INT    := v_cycle - (v_now % v_cycle)::INT;
  v_draw_at  INT;
  v_rtp      NUMERIC;
  v_mult_s   NUMERIC; v_mult_d NUMERIC; v_mult_t NUMERIC;
  v_round    public.rounds;
BEGIN
  SELECT draw_at_second, rtp_percentage,
         payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple
    INTO v_draw_at, v_rtp, v_mult_s, v_mult_d, v_mult_t
    FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage,
                               payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting', v_rtp,
            v_mult_s, v_mult_d, v_mult_t)
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
$function$;

CREATE OR REPLACE FUNCTION public.tick_rounds()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle    CONSTANT INT := 103;
  v_now      BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_current  BIGINT := v_now / v_cycle;
  v_into     INT    := (v_now % v_cycle)::INT;
  v_draw_at  INT;
  v_rtp      NUMERIC;
  v_mult_s   NUMERIC; v_mult_d NUMERIC; v_mult_t NUMERIC;
  v_r        RECORD;
  v_drawn    INT := 0;
  v_settled  INT := 0;
  v_failed   INT := 0;
BEGIN
  SELECT draw_at_second, rtp_percentage,
         payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple
    INTO v_draw_at, v_rtp, v_mult_s, v_mult_d, v_mult_t
    FROM public.game_config WHERE id = 'global';

  -- Create the current round even when nobody is online, so the round history
  -- stays continuous instead of gapping whenever no player is connected.
  INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage,
                             payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple)
  VALUES (v_current, to_timestamp((v_current + 1) * v_cycle), 'betting', v_rtp,
          v_mult_s, v_mult_d, v_mult_t)
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
$function$;

COMMIT;
