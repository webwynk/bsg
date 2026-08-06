-- ============================================================================
-- Round scheduler + stale-round bet guard
--
-- WHY THIS EXISTS
--
-- Live testing on 2026-08-07 found that only 2 of 17 rounds had ever been
-- drawn. The cause: draw_round/settle_round were invoked ONLY from
-- get_current_round, and only while a client happened to call it inside the
-- 9-second window between draw_at_second (94) and the end of the cycle (103).
--
-- Nothing else ever triggered a draw. So:
--   * a round nobody was watching at T+94 was never drawn,
--   * and it could never be drawn afterwards, because get_current_round only
--     ever looks at the round matching the CURRENT round_number.
--
-- Such a round keeps red IS NULL and phase 'betting' forever, which in turn
-- made it a permanently valid bet target (see place_bet below). Players'
-- stakes were debited into rounds that could never settle.
--
-- Two changes, either of which alone is insufficient:
--   1. tick_rounds() + pg_cron  — the draw no longer depends on a client
--      being connected. This is the correctness guarantee.
--   2. place_bet round-number guard — a bet is only ever accepted for the
--      round the clock says is current, whatever the client sends.
--
-- The lazy draw inside get_current_round is deliberately KEPT. It is the
-- low-latency path: an online player triggers the draw at exactly T+94 rather
-- than waiting for the next cron tick. Cron is the safety net, not the
-- primary mechanism.
-- ============================================================================

-- ── 1. Scheduled draw + settle ──────────────────────────────────────────────

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
  v_r        RECORD;
  v_drawn    INT := 0;
  v_settled  INT := 0;
BEGIN
  SELECT draw_at_second INTO v_draw_at FROM public.game_config WHERE id = 'global';

  -- Create the current round even when nobody is online, so the round history
  -- stays continuous instead of gapping whenever no player is connected.
  INSERT INTO public.rounds (round_number, scheduled_at, phase)
  VALUES (v_current, to_timestamp((v_current + 1) * v_cycle), 'betting')
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
    -- Both are idempotent: draw_round returns already_drawn when red is set,
    -- settle_round returns not_drawn when it is not, and only ever touches
    -- bets with is_settled = false.
    IF v_r.red IS NULL THEN
      PERFORM public.draw_round(v_r.id);
      v_drawn := v_drawn + 1;
    END IF;
    PERFORM public.settle_round(v_r.id);
    v_settled := v_settled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'round_number', v_current,
    'seconds_into', v_into,
    'drawn',        v_drawn,
    'settled',      v_settled
  );
END;
$function$;

-- Only the scheduler runs this. No client role is granted EXECUTE: a player
-- able to call it directly could force an early draw.
REVOKE ALL ON FUNCTION public.tick_rounds() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tick_rounds() IS
  'Draws and settles any round past draw_at_second. Runs from pg_cron so that '
  'settlement never depends on a client being connected. Idempotent.';

-- ── 2. Schedule it ──────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Unschedule first so re-running this migration does not create duplicate jobs.
DO $$
BEGIN
  PERFORM cron.unschedule('bsg-tick-rounds');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- not scheduled yet
END $$;

-- Every 10 seconds. The exact cadence is not gameplay-critical because online
-- players still trigger the draw at T+94 via get_current_round; this only has
-- to guarantee that an unattended round settles promptly.
SELECT cron.schedule('bsg-tick-rounds', '10 seconds', $$SELECT public.tick_rounds()$$);
