-- #############################################################################
-- LUCKY CARD - GAME FUNCTIONS 5 of 6: THE SERVER TICK AND ITS CRON JOB
-- Migration: 20261005130000_lucky_card_tick_rounds.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 6 (Q48), 14.18
-- #############################################################################
--
-- PURELY ADDITIVE. Creates one new function and one new pg_cron job.
-- Nothing belonging to Triple Chance is altered, dropped, replaced or called:
-- tick_rounds() and the pg_cron job 'bsg-tick-rounds' are untouched.
--
-- WHAT IT DOES
-- ------------
-- Every 10 seconds the scheduler calls lucky_card_tick_rounds(), which:
--   1. Creates the round for the current 103-second cycle if no player's phone
--      has yet, pinning RTP and bonus onto it exactly as
--      lucky_card_get_current_round() does (including the one-shot bonus reset).
--   2. Draws and settles every round that is due: any earlier round that is not
--      yet settled, and the current round once draw_at_second (89) is reached.
--      At most 20 rounds per call, oldest first.
--   3. Returns round_number, seconds_into, drawn, settled, failed.
--
-- WHY IT EXISTS
-- -------------
-- While players have the game screen open their phones poll every 2 seconds
-- through lucky_card_get_current_round(), which draws and settles on its own, so
-- this tick makes no visible difference to anyone watching. It is the safety net
-- for rounds nobody is polling: a player who locked chips and closed the app is
-- still drawn and paid, and a large settlement that needs several batches keeps
-- draining. It is safe to run alongside the polls: draw and settle are
-- idempotent and serialise on the round row.
--
-- CADENCE - Q48, chosen by the user 2026-10-05: 10 seconds, the same as Triple
-- Chance's job.
--
-- SHARED OBJECTS USED
-- -------------------
--   * public.audit_log - one 'system' row when a draw or settlement fails,
--     prefixed 'lucky_card_tick_rounds:'. Rows are only added. Same use, and
--     the same destination (option A), the user approved for
--     lucky_card_get_current_round() on 2026-10-05.
--   * the pg_cron scheduler - ONE new job, 'bsg-lucky-card-tick-rounds'. The
--     existing job 'bsg-tick-rounds' is not modified. To stop Lucky Card
--     ticking without removing the function:
--         SELECT cron.alter_job((SELECT jobid FROM cron.job
--                                 WHERE jobname = 'bsg-lucky-card-tick-rounds'),
--                               active := false);
--     To remove it entirely:
--         SELECT cron.unschedule('bsg-lucky-card-tick-rounds');
--
-- KNOWN BEHAVIOUR, inherited from tick_rounds(): a round that keeps failing is
-- retried every tick and writes one audit_log row each time.
-- #############################################################################

BEGIN;

CREATE FUNCTION public.lucky_card_tick_rounds()
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
    FROM public.lucky_card_config WHERE id = 'global';

  INSERT INTO public.lucky_card_rounds (round_number, scheduled_at, phase, rtp_percentage, bonus_multiplier)
  VALUES (v_current, to_timestamp((v_current + 1) * v_cycle), 'betting', v_rtp, v_bonus)
  ON CONFLICT (round_number) DO NOTHING
  RETURNING id INTO v_inserted_id;

  -- Same one-shot bonus reset as lucky_card_get_current_round(): only the
  -- caller that created the round resets the dial, and only if it still holds
  -- the value just captured.
  IF v_inserted_id IS NOT NULL AND v_bonus != 1 THEN
    UPDATE public.lucky_card_config SET bonus_multiplier = 1, updated_at = NOW()
     WHERE id = 'global' AND bonus_multiplier = v_bonus;
  END IF;

  FOR v_r IN
    SELECT id, winning_rank
      FROM public.lucky_card_rounds
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
        PERFORM public.lucky_card_draw_round(v_r.id);
        v_drawn := v_drawn + 1;
      END IF;
      PERFORM public.lucky_card_settle_round(v_r.id);
      v_settled := v_settled + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.audit_log (actor_id, kind, detail)
      VALUES (NULL, 'system',
        format('lucky_card_tick_rounds: round %s failed to draw/settle: %s', v_r.id, SQLERRM));
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

-- Internal: the scheduler and service_role only, mirroring tick_rounds()'s live
-- ACL. A client able to call this could force an early draw of an old round.
-- Default privileges would otherwise grant EXECUTE to anon and authenticated
-- (Issue #120). CREATE OR REPLACE keeps these grants; DROP + CREATE does not.
REVOKE ALL ON FUNCTION public.lucky_card_tick_rounds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lucky_card_tick_rounds() TO service_role;

COMMENT ON FUNCTION public.lucky_card_tick_rounds() IS
  'Creates the current Lucky Card round and draws and settles any round that is '
  'due, up to 20 per call, oldest first. Runs from pg_cron so that settlement '
  'never depends on a player being connected. Idempotent. Internal; service_role only.';

-- ── The schedule ────────────────────────────────────────────────────────────

-- Unschedule first so re-running this migration does not create a duplicate job.
DO $$
BEGIN
  PERFORM cron.unschedule('bsg-lucky-card-tick-rounds');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- not scheduled yet
END $$;

-- Every 10 seconds (Q48), the same cadence as Triple Chance's job.
SELECT cron.schedule('bsg-lucky-card-tick-rounds', '10 seconds', $$SELECT public.lucky_card_tick_rounds()$$);

COMMIT;
