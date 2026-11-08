-- ============================================================================
-- Triple Chance round-lock fix (Option 1 = Fix A + Fix B + B-opt-1).
-- Plan, audits and test results: docs/loadtest/tc_fix/ (TC_LOCK_FIX_PLAN.md,
-- AUDIT2_2026-11-08.md, local_test/TEST_RESULTS_2026-11-08.md: T0-T8 passed on
-- a local PostgreSQL 17.11 copy of the live schema).
-- Built from the live definitions dumped from ezcmxxfhjtzqolbtmshr on
-- 2026-11-08; apply only with docs/loadtest/tc_fix/apply_live_tc_round_lock_fix.js,
-- which refuses unless live still matches those dumps byte for byte.
--
-- Fix A -- get_current_round + settle_round: a round that is already
--   'settled' is answered without taking the round row lock, so polls in
--   seconds 90-102 no longer queue one behind another.
-- Fix B -- place_bet + tc_print_ticket: the round row is locked FOR SHARE
--   (was FOR UPDATE) after an early unlocked check, so bets of different
--   players run in parallel; draw_round (unchanged, FOR UPDATE) still waits
--   for every in-flight bet, and a bet after the draw still gets
--   ROUND_CLOSED. place_bet locks and re-reads the player's profile row
--   (SELECT ... FOR UPDATE + is_active re-check, as in Lucky Card) before
--   reading the old stake, so one player's own double-tap is still
--   one-at-a-time and the returned coin_balance is read after the lock.
--
-- Unchanged: draw_round, tick_rounds, apply_bonus_to_current_round,
--   apply_coin_movement, get_my_round_result, all tables, grants, cron.
-- CREATE OR REPLACE keeps each function's owner, grants and comment.
-- Undo: bsg_web_dashboard/scripts/tc_round_lock_fix_rollback.sql (exact live
--   definitions of 2026-11-08).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_current_round()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle       CONSTANT INT := 103;
  v_now         BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_number      BIGINT := v_now / v_cycle;
  v_into        INT    := (v_now % v_cycle)::INT;
  v_left        INT    := v_cycle - (v_now % v_cycle)::INT;
  v_draw_at     INT;
  v_rtp         NUMERIC;
  v_bonus       SMALLINT;
  v_round       public.rounds;
  v_inserted_id UUID;
BEGIN
  SELECT draw_at_second, rtp_percentage, bonus_multiplier
    INTO v_draw_at, v_rtp, v_bonus
    FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage, bonus_multiplier)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting', v_rtp, v_bonus)
    ON CONFLICT (round_number) DO NOTHING
    RETURNING id INTO v_inserted_id;

    -- One-shot nudge, not a sticky setting (Issue #99) -- only the caller
    -- that actually won the insert race resets it (avoids redundant/racy
    -- resets from callers who lost the ON CONFLICT race), and only if the
    -- dial still says what we just captured (avoids clobbering a genuinely
    -- newer admin change made in the same narrow window).
    IF v_inserted_id IS NOT NULL AND v_bonus != 1 THEN
      UPDATE public.game_config SET bonus_multiplier = 1, updated_at = NOW()
       WHERE id = 'global' AND bonus_multiplier = v_bonus;
    END IF;

    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  -- Draw/settle only when there is something left to do. 'settled' is final
  -- (only settle_round sets it, nothing sets it back, and a settled round's
  -- digits and bonus can no longer change), so a round already read as
  -- 'settled' needs no draw_round/settle_round call and no row lock: the
  -- answer below is exactly what settle_round's 'already_settled' path
  -- would have led to. Any other state (not drawn, or still 'drawing'
  -- because a big round settles in batches) goes through the locked path.
  IF v_into >= v_draw_at
     AND (v_round.red IS NULL OR v_round.phase IS DISTINCT FROM 'settled') THEN
    -- Issue #14 fix (unchanged): a failure here must never propagate --
    -- every connected player's device calls this every 2 seconds.
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
    'black',             v_round.black,
    'bonus_multiplier',  CASE WHEN v_round.red IS NULL THEN NULL ELSE v_round.bonus_multiplier END
  );
END;
$function$;

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
  SELECT settle_batch_size INTO v_batch_size FROM public.game_config WHERE id = 'global';

  -- Unlocked fast path: 'settled' is final (rounds_settled_has_digits means
  -- red is set too), so this is the same answer the locked check below gives
  -- for a settled round, without queueing on the round row lock. Every other
  -- case (missing, not drawn, still 'drawing') takes the lock and is
  -- re-checked under it exactly as before.
  PERFORM 1 FROM public.rounds WHERE id = p_round_id AND phase = 'settled';
  IF FOUND THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'already_settled');
  END IF;

  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.red IS NULL THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'not_drawn');
  END IF;

  IF v_round.phase = 'settled' THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'already_settled');
  END IF;

  v_s_key := v_round.black::TEXT;
  v_d_key := v_round.green::TEXT || v_round.black::TEXT;
  v_t_key := v_round.red::TEXT || v_round.green::TEXT || v_round.black::TEXT;

  WITH batch AS (
    SELECT id, single_bets, double_bets, triple_bets
      FROM public.bets
     WHERE round_id = p_round_id AND NOT is_settled
     ORDER BY id
     LIMIT v_batch_size
     FOR UPDATE
  ),
  computed AS (
    -- Base rate is permanent (x9/x90/x900) -- unchanged, still the same
    -- literal draw_round targets against. bonus_multiplier is THIS round's
    -- own pinned promotional factor (1 = no bonus, today's exact behavior;
    -- 2/3/4 = 2X/3X/4X), applied ONLY here as pure additional payout --
    -- draw_round never sees it and its RTP-targeting math is unaffected.
    SELECT
      id,
      (COALESCE((single_bets ->> v_s_key)::BIGINT, 0) * 9   * v_round.bonus_multiplier)::BIGINT AS s_pay,
      (COALESCE((double_bets ->> v_d_key)::BIGINT, 0) * 90  * v_round.bonus_multiplier)::BIGINT AS d_pay,
      (COALESCE((triple_bets ->> v_t_key)::BIGINT, 0) * 900 * v_round.bonus_multiplier)::BIGINT AS t_pay
    FROM batch
  ),
  scored AS (
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
    SELECT id AS bet_id, user_id, total_payout
      FROM scored
     WHERE total_payout > 0
  ),
  paid AS (
    UPDATE public.profiles p
       SET coin_balance   = p.coin_balance + winners.total_payout,
           ledger_version = p.ledger_version + 1,
           updated_at     = NOW()
      FROM winners
     WHERE p.id = winners.user_id
    RETURNING p.id AS user_id, p.coin_balance AS new_balance, winners.total_payout, winners.bet_id
  ),
  ledgered AS (
    INSERT INTO public.coin_ledger (user_id, counterparty_id, kind, amount, balance_after, round_id)
    SELECT user_id, NULL, 'payout', total_payout, new_balance, p_round_id
      FROM paid
    RETURNING amount
  )
  SELECT
    (SELECT count(*) FROM scored),
    COALESCE((SELECT sum(amount) FROM ledgered), 0)
    INTO v_batch_count, v_batch_paid;

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

CREATE OR REPLACE FUNCTION public.place_bet(p_round_id uuid, p_single_bets jsonb, p_double_bets jsonb, p_triple_bets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user     UUID := auth.uid();
  v_profile  public.profiles;
  v_round    public.rounds;
  v_lim      public.play_limits;
  v_cfg      public.game_config;
  v_cycle    CONSTANT INT := 103;
  v_into     INT := (EXTRACT(EPOCH FROM NOW())::BIGINT % v_cycle)::INT;
  v_k        TEXT;
  v_v        BIGINT;
  v_stake    BIGINT := 0;
  v_prev     BIGINT := 0;
  v_delta    BIGINT;
  v_balance  BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;
  IF v_profile.role <> 'player' THEN
    RAISE EXCEPTION 'Only players may place bets' USING errcode = 'P0114';
  END IF;

  -- A print player bets only through printed tickets. A normal bet replaces the
  -- board and refunds the difference, so it must never touch their round row.
  IF public.print_blocks_normal_bet(v_user, 'TC', EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle, v_cycle) THEN
    RAISE EXCEPTION 'PRINT_REQUIRED' USING errcode = 'P0155';
  END IF;

  SELECT * INTO v_cfg FROM public.game_config WHERE id = 'global';
  SELECT * INTO v_lim FROM public.play_limits WHERE id = 'global';

  -- Early, unlocked copy of the checks below: same errors, same order. A call
  -- that is already too late (or for a missing/drawn round) fails here
  -- without touching the round row lock, so after the cutoff no new lock
  -- holders appear and the draw never waits for late callers.
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
  END IF;
  IF v_round.red IS NOT NULL
     OR v_into >= v_cfg.bet_cutoff_second
     OR v_round.round_number <> (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;

  -- FOR SHARE, not FOR UPDATE: bets of different players in the same round
  -- run side by side (shared locks do not block each other), but draw_round
  -- takes FOR UPDATE on this row, which waits for every bet already holding
  -- the shared lock to commit, and any bet arriving after that waits for the
  -- draw and then sees red set (ROUND_CLOSED below). place_bet never updates
  -- the round row (draw_round sums total_stake from bets itself).
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
  END IF;

  -- Three independent guards, re-checked under the lock.
  --
  -- The second guard checks game_config.bet_cutoff_second, a real, earlier,
  -- database-enforced cutoff -- not draw_at_second, which is the draw
  -- trigger itself. See 20260808000600_restore_bet_cutoff_margin.sql.
  IF v_round.red IS NOT NULL THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_into >= v_cfg.bet_cutoff_second THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_round.round_number <> (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;

  -- ── validate + total, one board at a time ────────────────────────────────
  FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(COALESCE(p_single_bets,'{}')) LOOP
    IF v_k !~ '^[0-9]$' THEN RAISE EXCEPTION 'BAD_SINGLE_KEY:%', v_k USING errcode='P0122'; END IF;
    IF v_v < v_lim.single_min THEN RAISE EXCEPTION 'BELOW_MIN' USING errcode='P0123'; END IF;
    IF v_v > v_lim.single_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode='P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(COALESCE(p_double_bets,'{}')) LOOP
    IF v_k !~ '^[0-9]{2}$' THEN RAISE EXCEPTION 'BAD_DOUBLE_KEY:%', v_k USING errcode='P0122'; END IF;
    IF v_v < v_lim.double_min THEN RAISE EXCEPTION 'BELOW_MIN' USING errcode='P0123'; END IF;
    IF v_v > v_lim.double_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode='P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(COALESCE(p_triple_bets,'{}')) LOOP
    IF v_k !~ '^[0-9]{3}$' THEN RAISE EXCEPTION 'BAD_TRIPLE_KEY:%', v_k USING errcode='P0122'; END IF;
    IF v_v < v_lim.triple_min THEN RAISE EXCEPTION 'BELOW_MIN' USING errcode='P0123'; END IF;
    IF v_v > v_lim.triple_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode='P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  IF v_stake <= 0 THEN
    RAISE EXCEPTION 'EMPTY_BET' USING errcode = 'P0125';
  END IF;

  -- One bet change per player at a time. The shared round lock no longer
  -- queues a player's own double-tap, so the player's profile row is locked
  -- here, before the old stake is read: a second call by the same player
  -- waits, then reads the stake the first one committed. The profile is
  -- re-read under the lock (same as Lucky Card's place_bet), so the account
  -- is re-checked and the coin_balance returned when nothing changes is the
  -- committed one, not the copy read before the wait. (apply_coin_movement
  -- locks this same row again; that is a no-op inside this transaction.)
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;

  -- Replacing an existing bet charges only the difference.
  SELECT total_stake INTO v_prev FROM public.bets
    WHERE round_id = p_round_id AND user_id = v_user FOR UPDATE;
  v_prev  := COALESCE(v_prev, 0);
  v_delta := v_stake - v_prev;

  IF v_delta <> 0 THEN
    -- A reduced bet is a stake_refund, never a 'payout' -- booking it as a
    -- payout would inflate every win statistic in the dashboard.
    v_balance := public.apply_coin_movement(
      v_user, NULL, CASE WHEN v_delta > 0 THEN 'stake' ELSE 'stake_refund' END,
      -v_delta, p_round_id);
  ELSE
    v_balance := v_profile.coin_balance;
  END IF;

  INSERT INTO public.bets (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
  VALUES (p_round_id, v_user,
          COALESCE(p_single_bets,'{}'), COALESCE(p_double_bets,'{}'),
          COALESCE(p_triple_bets,'{}'), v_stake)
  ON CONFLICT (round_id, user_id) DO UPDATE
    SET single_bets = EXCLUDED.single_bets,
        double_bets = EXCLUDED.double_bets,
        triple_bets = EXCLUDED.triple_bets,
        total_stake = EXCLUDED.total_stake,
        is_settled  = false,
        single_payout = 0, double_payout = 0, triple_payout = 0, total_payout = 0;

  RETURN jsonb_build_object(
    'success',        true,
    'total_stake',    v_stake,
    'coin_balance',   v_balance,
    'ledger_version', (SELECT ledger_version FROM public.profiles WHERE id = v_user)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tc_print_ticket(p_round_id uuid, p_single_bets jsonb, p_double_bets jsonb, p_triple_bets jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user     UUID := auth.uid();
  v_profile  public.profiles;
  v_round    public.rounds;
  v_ticket   public.print_tickets;
  v_lim      public.play_limits;
  v_on       BOOLEAN;
  v_cutoff   INT;
  v_cycle    CONSTANT INT := 103;
  v_into     INT := (EXTRACT(EPOCH FROM NOW())::BIGINT % v_cycle)::INT;
  v_board    TEXT;
  v_bets     JSONB;
  v_pattern  TEXT;
  v_min      BIGINT;
  v_max      BIGINT;
  v_k        TEXT;
  v_val      JSONB;
  v_v        BIGINT;
  v_stake    BIGINT := 0;
  v_items    JSONB := jsonb_build_object('single', '{}'::jsonb, 'double', '{}'::jsonb, 'triple', '{}'::jsonb);
  v_balance  BIGINT;
  v_no       BIGINT;
  v_code     TEXT;
  v_repeat   BOOLEAN := false;
  v_clash    TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;
  IF v_profile.role <> 'player' THEN
    RAISE EXCEPTION 'Only players may place bets' USING errcode = 'P0114';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'BAD_BET:request' USING errcode = 'P0122';
  END IF;

  -- A press sent again, because its reply was lost, gets the same ticket. This
  -- comes before the round checks: the round may have closed since.
  SELECT * INTO v_ticket FROM public.print_tickets
   WHERE user_id = v_user AND client_request_id = p_request_id;
  IF FOUND THEN
    v_repeat := true;
  ELSE
    SELECT enabled INTO v_on FROM public.print_settings WHERE id = 'global';
    IF v_on IS NOT TRUE THEN
      RAISE EXCEPTION 'PRINT_OFF' USING errcode = 'P0157';
    END IF;

    SELECT bet_cutoff_second INTO v_cutoff FROM public.game_config WHERE id = 'global';
    SELECT * INTO v_lim FROM public.play_limits WHERE id = 'global';

    -- The same closed-round guards, and the same lock, as place_bet: an
    -- early unlocked check (same errors, same order), then FOR SHARE, so
    -- tickets and bets of different players run side by side while
    -- draw_round's FOR UPDATE still waits for all of them. A player's own
    -- tickets stay correct without an extra lock: the counter, the balance
    -- and the board (which tickets add to) are each locked row by row.
    SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
    END IF;
    IF v_round.red IS NOT NULL
       OR v_into >= v_cutoff
       OR v_round.round_number <> (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) THEN
      RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
    END IF;

    SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
    END IF;
    IF v_round.red IS NOT NULL THEN
      RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
    END IF;
    IF v_into >= v_cutoff THEN
      RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
    END IF;
    IF v_round.round_number <> (EXTRACT(EPOCH FROM NOW())::BIGINT / v_cycle) THEN
      RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
    END IF;

    IF NOT public.print_active_for_round(v_user, to_timestamp(v_round.round_number * v_cycle)) THEN
      RAISE EXCEPTION 'PRINT_NOT_ACTIVE' USING errcode = 'P0158';
    END IF;

    -- The same limits as place_bet, for this ticket alone.
    FOREACH v_board IN ARRAY ARRAY['single','double','triple'] LOOP
      IF v_board = 'single' THEN
        v_bets := p_single_bets; v_pattern := '^[0-9]$';     v_min := v_lim.single_min; v_max := v_lim.single_max;
      ELSIF v_board = 'double' THEN
        v_bets := p_double_bets; v_pattern := '^[0-9]{2}$';  v_min := v_lim.double_min; v_max := v_lim.double_max;
      ELSE
        v_bets := p_triple_bets; v_pattern := '^[0-9]{3}$';  v_min := v_lim.triple_min; v_max := v_lim.triple_max;
      END IF;
      v_bets := COALESCE(v_bets, '{}'::jsonb);
      IF jsonb_typeof(v_bets) <> 'object' THEN
        RAISE EXCEPTION 'BAD_BET:not an object' USING errcode = 'P0122';
      END IF;
      FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_bets) LOOP
        IF v_k !~ v_pattern THEN
          RAISE EXCEPTION 'BAD_KEY:%', v_k USING errcode = 'P0122';
        END IF;
        IF jsonb_typeof(v_val) <> 'number' OR v_val::text !~ '^-?[0-9]{1,15}$' THEN
          RAISE EXCEPTION 'BAD_KEY:%', v_k USING errcode = 'P0122';
        END IF;
        v_v := v_val::text::BIGINT;
        IF v_v < v_min THEN RAISE EXCEPTION 'BELOW_MIN'   USING errcode = 'P0123'; END IF;
        IF v_v > v_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode = 'P0124'; END IF;
        v_stake := v_stake + v_v;
      END LOOP;
      v_items := jsonb_set(v_items, ARRAY[v_board], v_bets);
    END LOOP;

    IF v_stake <= 0 THEN
      RAISE EXCEPTION 'EMPTY_BET' USING errcode = 'P0125';
    END IF;

    BEGIN
      -- Rolls back with everything else on a refusal: no gap in the numbers.
      SELECT a.ticket_no, a.ticket_code INTO v_no, v_code
        FROM public.print_allocate_ticket(v_user, 'TC') a;

      v_balance := public.apply_coin_movement(v_user, NULL, 'stake', -v_stake, p_round_id, v_code);

      INSERT INTO public.bets AS b (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
      VALUES (p_round_id, v_user, v_items->'single', v_items->'double', v_items->'triple', v_stake)
      ON CONFLICT (round_id, user_id) DO UPDATE
        SET single_bets = public.tc_add_boards(b.single_bets, EXCLUDED.single_bets),
            double_bets = public.tc_add_boards(b.double_bets, EXCLUDED.double_bets),
            triple_bets = public.tc_add_boards(b.triple_bets, EXCLUDED.triple_bets),
            total_stake = b.total_stake + EXCLUDED.total_stake;

      INSERT INTO public.print_tickets
        (game, ticket_no, ticket_code, user_id, round_id, round_number,
         items, total_stake, client_request_id)
      VALUES
        ('TC', v_no, v_code, v_user, p_round_id, v_round.round_number,
         v_items, v_stake, p_request_id)
      RETURNING * INTO v_ticket;
    EXCEPTION WHEN unique_violation THEN
      -- The same press, sent twice at once: this copy undoes itself and answers
      -- with the ticket the other one made.
      GET STACKED DIAGNOSTICS v_clash = CONSTRAINT_NAME;
      IF v_clash IS DISTINCT FROM 'print_tickets_one_per_press' THEN
        RAISE;
      END IF;
      SELECT * INTO v_ticket FROM public.print_tickets
       WHERE user_id = v_user AND client_request_id = p_request_id;
      v_repeat := true;
    END;
  END IF;

  IF v_ticket.game <> 'TC' THEN
    RAISE EXCEPTION 'BAD_BET:request' USING errcode = 'P0122';
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'repeat',         v_repeat,
    'ticket_id',      v_ticket.id,
    'ticket_code',    v_ticket.ticket_code,
    'ticket_no',      v_ticket.ticket_no,
    'round_id',       v_ticket.round_id,
    'round_number',   v_ticket.round_number,
    'items',          v_ticket.items,
    'total_stake',    v_ticket.total_stake,
    'print_status',   v_ticket.print_status,
    'created_at',     v_ticket.created_at,
    'round_total',    (SELECT total_stake FROM public.bets
                        WHERE round_id = v_ticket.round_id AND user_id = v_user),
    'coin_balance',   (SELECT coin_balance FROM public.profiles WHERE id = v_user),
    'ledger_version', (SELECT ledger_version FROM public.profiles WHERE id = v_user)
  );
END;
$function$;

COMMIT;
