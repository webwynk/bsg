-- Issue #43, Steps 1-3 (MASTER_AUDIT_AND_REMEDIATION_PLAN.md): pin the payout
-- multiplier onto each round at the moment it's created, instead of both
-- draw_round() and settle_round() reading game_config.payout_multiplier_*
-- live and independently.
--
-- Root cause this closes: draw_round (RTP-target calc) and settle_round
-- (actual payout, possibly seconds later under Issue #42's batching) each
-- read the multiplier at their own separate moment. A dashboard change
-- landing in that window meant the number chosen to hit one rate could be
-- paid out at a different rate -- silently breaking that round's RTP math,
-- not just its on-screen display.
--
-- Fix: every round now carries its own fixed payout_multiplier_single/
-- double/triple, captured once, at creation, from whatever game_config says
-- at that instant. draw_round and settle_round both read from the round
-- itself from then on. This also gives a free, permanent historical record --
-- any past round can always answer "what rate applied to you," forever.
--
-- Two places create a round row and both need to start capturing this:
-- get_current_round() (the lazy, client-triggered path) and tick_rounds()
-- (the scheduled backup path). get_play_limits() -- what the app asks to
-- learn the current rate -- is changed to read from the currently-active
-- round rather than game_config directly, so the app is always told exactly
-- what the live round will actually pay (falling back to game_config only in
-- the narrow case where the current round hasn't been created by anyone's
-- poll yet).

BEGIN;

ALTER TABLE public.rounds
  ADD COLUMN payout_multiplier_single NUMERIC(8,2) NOT NULL DEFAULT 9.0   CHECK (payout_multiplier_single > 0),
  ADD COLUMN payout_multiplier_double NUMERIC(8,2) NOT NULL DEFAULT 90.0  CHECK (payout_multiplier_double > 0),
  ADD COLUMN payout_multiplier_triple NUMERIC(8,2) NOT NULL DEFAULT 900.0 CHECK (payout_multiplier_triple > 0);

-- get_current_round(): the lazy path. Now captures the live multiplier onto
-- the round at creation. Everything else (draw/settle triggering, the
-- returned telemetry shape) is unchanged.
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
  v_mult_s   NUMERIC; v_mult_d NUMERIC; v_mult_t NUMERIC;
  v_round    public.rounds;
BEGIN
  SELECT draw_at_second, payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple
    INTO v_draw_at, v_mult_s, v_mult_d, v_mult_t
    FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    INSERT INTO public.rounds (round_number, scheduled_at, phase,
                               payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting',
            v_mult_s, v_mult_d, v_mult_t)
    ON CONFLICT (round_number) DO NOTHING;
    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  IF v_into >= v_draw_at THEN
    IF v_round.red IS NULL THEN
      PERFORM public.draw_round(v_round.id);
    END IF;
    PERFORM public.settle_round(v_round.id);
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

-- tick_rounds(): the scheduled backup path. Same treatment -- captures the
-- live multiplier onto the round at creation. Draw/settle loop and LIMIT 20
-- batching are unchanged.
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
  v_mult_s   NUMERIC; v_mult_d NUMERIC; v_mult_t NUMERIC;
  v_r        RECORD;
  v_drawn    INT := 0;
  v_settled  INT := 0;
BEGIN
  SELECT draw_at_second, payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple
    INTO v_draw_at, v_mult_s, v_mult_d, v_mult_t
    FROM public.game_config WHERE id = 'global';

  -- Create the current round even when nobody is online, so the round history
  -- stays continuous instead of gapping whenever no player is connected.
  INSERT INTO public.rounds (round_number, scheduled_at, phase,
                             payout_multiplier_single, payout_multiplier_double, payout_multiplier_triple)
  VALUES (v_current, to_timestamp((v_current + 1) * v_cycle), 'betting',
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

-- draw_round(): RTP-target calculation now reads the multiplier from the
-- round's own pinned value instead of live game_config. rtp_percentage
-- itself is NOT pinned (only the payout multiplier) -- still read live, same
-- as before. Everything else (Issue #13's unbiased sampling, zero-stake
-- branch) is unchanged.
CREATE OR REPLACE FUNCTION public.draw_round(p_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round        public.rounds;
  v_cfg          public.game_config;
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

  SELECT * INTO v_cfg FROM public.game_config WHERE id = 'global';

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
    v_target := v_stake * (v_cfg.rtp_percentage / 100.0);
    FOR v_r IN 0..9 LOOP
      FOR v_g IN 0..9 LOOP
        FOR v_b IN 0..9 LOOP
          v_payout := (v_s[v_b + 1] * v_round.payout_multiplier_single)
                    + (v_d[(v_g * 10 + v_b) + 1] * v_round.payout_multiplier_double)
                    + (v_t[(v_r * 100 + v_g * 10 + v_b) + 1] * v_round.payout_multiplier_triple);
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
$function$
;

-- settle_round(): actual payout now reads the SAME pinned multiplier
-- draw_round just used for this round -- the step that structurally
-- guarantees draw and settle can never disagree. game_config is no longer
-- read at all in this function (it was only ever fetched for the
-- multiplier). Batching logic from Issue #42 is otherwise unchanged.
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
    SELECT
      id,
      (COALESCE((single_bets ->> v_s_key)::BIGINT, 0) * v_round.payout_multiplier_single)::BIGINT AS s_pay,
      (COALESCE((double_bets ->> v_d_key)::BIGINT, 0) * v_round.payout_multiplier_double)::BIGINT AS d_pay,
      (COALESCE((triple_bets ->> v_t_key)::BIGINT, 0) * v_round.payout_multiplier_triple)::BIGINT AS t_pay
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
$$;

-- get_play_limits(): the app's own config-fetch call now reports the
-- multiplier from the CURRENTLY-ACTIVE round (computed the same way
-- get_current_round() identifies "now"'s round), not live game_config
-- directly -- so the app is told exactly what the live round will actually
-- pay. Falls back to game_config only in the narrow window where the
-- current round hasn't been created by anyone's poll yet.
CREATE OR REPLACE FUNCTION public.get_play_limits()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v        public.play_limits;
  v_cfg    public.game_config;
  v_round  public.rounds;
  v_number CONSTANT BIGINT := (EXTRACT(EPOCH FROM NOW())::BIGINT) / 103;
  v_mult_s NUMERIC; v_mult_d NUMERIC; v_mult_t NUMERIC;
BEGIN
  SELECT * INTO v FROM public.play_limits WHERE id = 'global';
  SELECT * INTO v_cfg FROM public.game_config WHERE id = 'global';
  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;

  v_mult_s := COALESCE(v_round.payout_multiplier_single, v_cfg.payout_multiplier_single);
  v_mult_d := COALESCE(v_round.payout_multiplier_double, v_cfg.payout_multiplier_double);
  v_mult_t := COALESCE(v_round.payout_multiplier_triple, v_cfg.payout_multiplier_triple);

  RETURN jsonb_build_object(
    'single', jsonb_build_object('min', v.single_min, 'max', v.single_max, 'multiplier', v_mult_s),
    'double', jsonb_build_object('min', v.double_min, 'max', v.double_max, 'multiplier', v_mult_d),
    'triple', jsonb_build_object('min', v.triple_min, 'max', v.triple_max, 'multiplier', v_mult_t)
  );
END;
$$;

COMMIT;
