-- Feature: admin-configurable bonus payout multiplier (N / 2X / 3X / 4X).
--
-- New superadmin dashboard control lets the admin pick a mutually-exclusive
-- multiplier (1 = "N", no bonus; 2/3/4 = 2X/3X/4X) that persists until
-- changed. The NEXT round created after a change pays out at the permanent
-- base rate (x9/x90/x900) TIMES that round's own pinned bonus_multiplier,
-- for every winning bet in that round.
--
-- draw_round's RTP-targeting math is deliberately untouched -- confirmed
-- with the product owner -- the bonus is pure additional payout on top of
-- whatever draw_round already decided. During an active 4X round the house
-- can pay out up to 4x the targeted RTP rate on winning bets, absorbed as
-- promotional cost with no automatic RTP compensation. Conscious decision,
-- not a side effect.
--
-- Pinning pattern: byte-for-byte the same "capture game_config onto the
-- round at creation, read only the round's own copy downstream" design
-- already proven live for rtp_percentage (20260808001100_pin_rtp_to_round.sql).
-- NOT the payout-multiplier pinning design that was later reverted
-- (20260819040000_permanent_payout_multipliers.sql) -- that reversion was a
-- PRODUCT decision (base x9/x90/x900 rates made permanent, never
-- admin-configurable again) plus an unrelated deployment-drift bug
-- (Issue #89), not a flaw in the pin-to-round architecture itself. This
-- feature is meant to be toggled often as a promotional lever, so pinning
-- it per round, exactly like RTP, is the correct call.

BEGIN;

-- game_config: the admin's live, currently-in-effect setting.
ALTER TABLE public.game_config
  ADD COLUMN bonus_multiplier SMALLINT NOT NULL DEFAULT 1
    CHECK (bonus_multiplier IN (1, 2, 3, 4));

-- rounds: this round's own FIXED copy, captured once at creation. settle_round
-- reads ONLY this column, never game_config -- an admin change mid-round can
-- never affect a round that has already started or is still settling.
ALTER TABLE public.rounds
  ADD COLUMN bonus_multiplier SMALLINT NOT NULL DEFAULT 1
    CHECK (bonus_multiplier IN (1, 2, 3, 4));

-- get_current_round(): captures game_config.bonus_multiplier onto the round
-- at creation, alongside the existing rtp_percentage capture. Returns the
-- round's own pinned bonus_multiplier gated behind the same "null until
-- drawn" rule already used for red/green/black -- delivered together, in the
-- same response, so the app can never receive one without the other (no
-- split-delivery window where the wrong reveal image could show).
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
  v_bonus    SMALLINT;
  v_round    public.rounds;
BEGIN
  SELECT draw_at_second, rtp_percentage, bonus_multiplier
    INTO v_draw_at, v_rtp, v_bonus
    FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage, bonus_multiplier)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting', v_rtp, v_bonus)
    ON CONFLICT (round_number) DO NOTHING;
    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  IF v_into >= v_draw_at THEN
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

-- tick_rounds(): same capture treatment for the scheduled backup path.
-- Draw/settle loop, LIMIT 20 batching, and fault isolation are all unchanged.
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
  v_bonus    SMALLINT;
  v_r        RECORD;
  v_drawn    INT := 0;
  v_settled  INT := 0;
  v_failed   INT := 0;
BEGIN
  SELECT draw_at_second, rtp_percentage, bonus_multiplier
    INTO v_draw_at, v_rtp, v_bonus
    FROM public.game_config WHERE id = 'global';

  INSERT INTO public.rounds (round_number, scheduled_at, phase, rtp_percentage, bonus_multiplier)
  VALUES (v_current, to_timestamp((v_current + 1) * v_cycle), 'betting', v_rtp, v_bonus)
  ON CONFLICT (round_number) DO NOTHING;

  FOR v_r IN
    SELECT id, red
      FROM public.rounds
     WHERE (round_number < v_current
            OR (round_number = v_current AND v_into >= v_draw_at))
       AND (red IS NULL OR phase <> 'settled')
     ORDER BY round_number
     LIMIT 20
  LOOP
    BEGIN
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

-- settle_round(): surgical diff against the current live function -- only
-- the three payout expressions in `computed` change (multiplied by this
-- round's own pinned bonus_multiplier). Everything else -- batching,
-- locking, idempotency, ledger writes -- is byte-for-byte unchanged.
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

COMMIT;
