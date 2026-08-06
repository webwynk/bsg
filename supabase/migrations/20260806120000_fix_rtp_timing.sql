-- =============================================================================
-- FIX: RTP CALCULATION TIMING  (findings N-1 and N-2)
-- Migration: 20260806120000_fix_rtp_timing.sql
-- Applies to: public.get_current_round()
-- =============================================================================
--
-- PROBLEM
-- -------
-- get_current_round() computed the winning digits at T+70s of the 103s cycle,
-- but the Flutter client submits every bet in a single call at T+90s, and
-- submit_round_bet() rejects any bet once digits exist:
--
--     IF v_round.red IS NOT NULL THEN
--       RAISE EXCEPTION 'Round already resolved' USING errcode = 'P0009';
--
-- Consequences observed in production:
--
--   N-1  Any client calling get_current_round() during T+70..T+90 created the
--        digits early, so EVERY player's bet that round was rejected with
--        P0009. The SuperAdmin Live Monitor polls this RPC every 5 seconds,
--        which made the failure deterministic whenever it was open. The client
--        discards the failure, so players saw no error at all.
--
--   N-2  At T+70 no bet rows exist yet for the round, so v_total_stake was
--        always 0 and calculate_round_rtp_outcome() always fell through to its
--        md5('bsg_tc_seed_' || round_number) branch. The global RTP setting in
--        agent_configs therefore had no effect on any outcome, and results were
--        a deterministic, publicly derivable hash of the round number.
--        Evidence: 152 of 172 rounds had digits; 140 of those had zero bets.
--
-- FIX
-- ---
-- Move digit calculation to T+94s -- strictly AFTER the T+93 betting cutoff in
-- submit_round_bet -- so the two phases cannot overlap:
--
--     second  0..90   betting            (client submits during second 90)
--     second 91..93   latency grace      (submit_round_bet still accepts)
--     second 94..102  digits + settlement
--
-- T+94 rather than T+90 is deliberate. v_secs_into is an integer, so a client
-- submitting during second 90 passes the "> 93" check with up to ~3s of network
-- latency. Calculating at T+90 would leave that grace period overlapping the
-- digit window and merely narrow the race instead of closing it.
--
-- Effects:
--   * N-1 fixed -- digits cannot exist while betting is legal, so P0009 can no
--     longer fire inside the betting window. The guard remains as
--     defence-in-depth for genuinely late arrivals.
--   * N-2 fixed -- every bet row is present when stakes are aggregated, so RTP
--     targeting operates for the first time and outcomes stop being a
--     predictable hash.
--   * Outcome disclosure closed -- no window exists in which digits are
--     readable while bets are still accepted.
--
-- TRADE-OFF (accepted)
--   The SuperAdmin Live Monitor loses its 20-second "God Mode Outcome Revealed"
--   preview; it now shows the result at spin start. Its "Collecting Live Player
--   Wagers (0s -> 70s)" copy should be updated to reflect the new schedule.
--   Clients receive the result ~4s later in the cycle; the Flutter client polls
--   for up to 8s after submitting, so it still picks the result up normally.
--
-- resolve_round_payouts is moved to the same threshold: it is a no-op while
-- digits are NULL, so leaving it at T+90 would just burn a call per poll.
--
-- Body is otherwise byte-identical to the live definition captured from
-- pkwifufxakvwyqjamywo before this migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_current_round()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle       CONSTANT INT := 103;  -- 90s betting + 13s spin
  v_bet_window  CONSTANT INT := 90;
  v_draw_at     CONSTANT INT := 94;   -- strictly after submit_round_bet's 93s cutoff
  v_now_epoch   BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_round_num   BIGINT := v_now_epoch / v_cycle;
  v_secs_into   INT    := (v_now_epoch % v_cycle)::INT;
  v_secs_left   INT    := v_cycle - v_secs_into;
  v_status      TEXT;
  v_round       public.triple_chance_rounds;
BEGIN
  v_status := CASE WHEN v_secs_into < v_bet_window THEN 'betting' ELSE 'spinning' END;

  SELECT * INTO v_round FROM public.triple_chance_rounds WHERE round_number = v_round_num;

  IF v_round IS NULL THEN
    INSERT INTO public.triple_chance_rounds
      (round_number, scheduled_at, status)
    VALUES
      (v_round_num, TO_TIMESTAMP((v_round_num + 1) * v_cycle), v_status)
    ON CONFLICT (round_number) DO NOTHING
    RETURNING * INTO v_round;

    IF v_round IS NULL THEN
      SELECT * INTO v_round FROM public.triple_chance_rounds WHERE round_number = v_round_num;
    END IF;
  END IF;

  -- N-1/N-2 FIX: draw only after the betting window AND its latency grace have
  -- closed, so every stake is visible to the RTP engine and no legal bet can be
  -- rejected by submit_round_bet's "round already resolved" guard.
  IF v_secs_into >= v_draw_at AND v_round.red IS NULL THEN
    PERFORM public.calculate_round_rtp_outcome(v_round.id);
    SELECT * INTO v_round FROM public.triple_chance_rounds WHERE round_number = v_round_num;
  END IF;

  -- Settlement follows the draw; a no-op while digits are NULL.
  IF v_secs_into >= v_draw_at THEN
    PERFORM public.resolve_round_payouts(v_round.id);
    SELECT * INTO v_round FROM public.triple_chance_rounds WHERE round_number = v_round_num;
  END IF;

  -- Update status if spinning/complete
  IF v_round.status != v_status THEN
    UPDATE public.triple_chance_rounds SET status = v_status WHERE id = v_round.id;
    v_round.status := v_status;
  END IF;

  RETURN jsonb_build_object(
    'round_id',          v_round.id,
    'round_number',      v_round.round_number,
    'status',            v_status,
    'scheduled_at',      v_round.scheduled_at,
    'seconds_remaining', v_secs_left,
    'red',               v_round.red,
    'green',             v_round.green,
    'black',             v_round.black
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
