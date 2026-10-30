-- #############################################################################
-- LUCKY 16 CARD - STEP 7: THE SERVER TICK, ITS CRON JOB, AND THE LIVE BONUS BOOST
-- Migration: 20261028170000_lucky16_tick_and_admin_bonus.sql
-- Plan: "Lucky 16 Card: build plan" step 7
-- #############################################################################
--
-- PURELY ADDITIVE. Creates two new functions and one new pg_cron job. Nothing
-- belonging to Triple Chance, Lucky Card or Spin2Win is altered, dropped,
-- replaced or called: tick_rounds(), lucky_card_tick_rounds(),
-- spin2win_tick_rounds(), the *_apply_bonus_to_current_round() functions and
-- the cron jobs 'bsg-tick-rounds', 'bsg-lucky-card-tick-rounds' and
-- 'bsg-spin2win-tick-rounds' are untouched.
--
-- lucky16_tick_rounds()
-- ---------------------
-- Twin of spin2win_tick_rounds() / lucky_card_tick_rounds() on the 103-second
-- cycle. Every 10 seconds the scheduler calls it, and it:
--   1. creates the round for the current cycle if no player's app has yet,
--      pinning RTP and the one-shot bonus exactly as
--      lucky16_get_current_round() does;
--   2. draws and settles every round that is due (any earlier unfinished
--      round, and the current one once draw_at_second is reached), at most 20
--      per call, oldest first; one round's failure never stops the others;
--   3. returns round_number, seconds_into, drawn, settled, failed.
-- It is the safety net for rounds nobody is polling: a player who locked
-- chips and closed the app is still drawn and paid. Draw and settle are
-- idempotent and serialise on the round row, so it is safe alongside polls.
--
-- FROM THE MOMENT THIS IS APPLIED a new (empty) Lucky 16 Card round is created
-- every 103 seconds, exactly as the other games' ticks do. With no bets they
-- draw a uniform card and settle with nothing to pay.
--
-- lucky16_apply_bonus_to_current_round(p_bonus)
-- ---------------------------------------------
-- Twin of lucky_card_apply_bonus_to_current_round(): the dashboard's "boost
-- the round running now" control. Sets the CURRENT round's pinned bonus
-- (1 = N, 2..10 = 2X..10X, as Lucky Card). Refused once the round is drawn.
-- Service role only (the dashboard server calls it after its own auth check).
--
-- SHARED OBJECTS USED
--   * public.audit_log - one 'system' row per failed draw/settle, prefixed
--     'lucky16_tick_rounds:'. Rows are only added (same use as the others).
--   * pg_cron - ONE new job, 'bsg-lucky16-tick-rounds'. To pause Lucky 16 Card:
--         SELECT cron.alter_job((SELECT jobid FROM cron.job
--                                 WHERE jobname = 'bsg-lucky16-tick-rounds'),
--                               active := false);
--     To remove it: SELECT cron.unschedule('bsg-lucky16-tick-rounds');
-- #############################################################################

BEGIN;

-- =============================================================================
-- lucky16_tick_rounds
-- =============================================================================
CREATE FUNCTION public.lucky16_tick_rounds()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cycle       CONSTANT INT := 103;
  v_now         BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_current     BIGINT := v_now / v_cycle;
  v_into        INT    := (v_now % v_cycle)::INT;
  v_draw_at     INT;
  v_rtp         NUMERIC;
  v_bonus       SMALLINT;
  v_r           RECORD;
  v_drawn       INT := 0;
  v_settled     INT := 0;
  v_failed      INT := 0;
  v_inserted_id UUID;
BEGIN
  SELECT draw_at_second, rtp_percentage, bonus_multiplier
    INTO v_draw_at, v_rtp, v_bonus
    FROM public.lucky16_config WHERE id = 'global';

  INSERT INTO public.lucky16_rounds (round_number, scheduled_at, phase, rtp_percentage, bonus_multiplier)
  VALUES (v_current, to_timestamp((v_current + 1) * v_cycle), 'betting', v_rtp, v_bonus)
  ON CONFLICT (round_number) DO NOTHING
  RETURNING id INTO v_inserted_id;

  -- Same one-shot bonus reset as lucky16_get_current_round(): only the
  -- caller that created the round resets the dial, and only if it still holds
  -- the value just captured.
  IF v_inserted_id IS NOT NULL AND v_bonus <> 1 THEN
    UPDATE public.lucky16_config SET bonus_multiplier = 1, updated_at = NOW()
     WHERE id = 'global' AND bonus_multiplier = v_bonus;
  END IF;

  FOR v_r IN
    SELECT id, winning_rank
      FROM public.lucky16_rounds
     WHERE (round_number < v_current
            OR (round_number = v_current AND v_into >= v_draw_at))
       AND (winning_rank IS NULL OR phase <> 'settled')
     ORDER BY round_number
     LIMIT 20
  LOOP
    -- One round's failure must never stop the others. The block is its own
    -- subtransaction, so a draw whose settlement then failed is undone too.
    BEGIN
      IF v_r.winning_rank IS NULL THEN
        PERFORM public.lucky16_draw_round(v_r.id);
        v_drawn := v_drawn + 1;
      END IF;
      PERFORM public.lucky16_settle_round(v_r.id);
      v_settled := v_settled + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.audit_log (actor_id, kind, detail)
      VALUES (NULL, 'system',
        format('lucky16_tick_rounds: round %s failed to draw/settle: %s', v_r.id, SQLERRM));
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
$fn$;

-- =============================================================================
-- lucky16_apply_bonus_to_current_round
-- =============================================================================
CREATE FUNCTION public.lucky16_apply_bonus_to_current_round(p_bonus SMALLINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cycle   CONSTANT INT := 103;
  v_number  BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle;
  v_round   public.lucky16_rounds;
BEGIN
  IF p_bonus IS NULL OR p_bonus < 1 OR p_bonus > 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_bonus');
  END IF;

  -- Row lock: serialises against lucky16_draw_round()'s own FOR UPDATE on
  -- the same row, so no torn state is possible either way.
  SELECT * INTO v_round FROM public.lucky16_rounds WHERE round_number = v_number FOR UPDATE;
  IF NOT FOUND THEN
    -- Nothing has created this cycle's round yet (no poll and no tick so far).
    RETURN jsonb_build_object('success', false, 'error', 'round_not_found');
  END IF;

  IF v_round.winning_rank IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_drawn', 'round_number', v_round.round_number);
  END IF;

  UPDATE public.lucky16_rounds SET bonus_multiplier = p_bonus WHERE id = v_round.id;

  RETURN jsonb_build_object('success', true, 'round_number', v_round.round_number, 'bonus_multiplier', p_bonus);
END;
$fn$;

-- =============================================================================
-- PRIVILEGES - internal, service_role only (matches the live Lucky Card twins)
-- =============================================================================
-- A client able to call the tick could force an early draw; a client able to
-- call the boost could change a round's bonus. Default privileges would grant
-- both to anon and authenticated (Issue #120). CREATE OR REPLACE keeps these
-- grants; DROP + CREATE does not.
REVOKE ALL ON FUNCTION public.lucky16_tick_rounds()                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lucky16_apply_bonus_to_current_round(SMALLINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lucky16_tick_rounds()                          TO service_role;
GRANT EXECUTE ON FUNCTION public.lucky16_apply_bonus_to_current_round(SMALLINT) TO service_role;

COMMENT ON FUNCTION public.lucky16_tick_rounds() IS
  'Creates the current Lucky 16 Card round and draws and settles any round that is '
  'due, up to 20 per call, oldest first. Runs from pg_cron every 10 s so that '
  'settlement never depends on a player being connected. Idempotent. '
  'Internal; service_role only.';
COMMENT ON FUNCTION public.lucky16_apply_bonus_to_current_round(SMALLINT) IS
  'Dashboard "boost current round": sets the running Lucky 16 Card round''s pinned '
  'bonus (1 = N, 2-10 = 2X-10X). Refused once drawn or if the round does not '
  'exist yet. Internal; service_role only.';

-- =============================================================================
-- The schedule
-- =============================================================================
-- Unschedule first so re-running this migration does not create a duplicate.
DO $$
BEGIN
  PERFORM cron.unschedule('bsg-lucky16-tick-rounds');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- not scheduled yet
END $$;

-- Every 10 seconds, the same cadence as the other three games' jobs.
SELECT cron.schedule('bsg-lucky16-tick-rounds', '10 seconds', $$SELECT public.lucky16_tick_rounds()$$);

COMMIT;
