-- Makes settle_round()'s batch size a live-adjustable config value instead of
-- a hardcoded constant, raised by the user after asking how many players one
-- batch can actually handle.
--
-- Root cause / context: the 3,000 figure in the original Issue #42 migration
-- was a reasonable default (matching tick_rounds()'s own LIMIT-20-rounds-per-
-- tick philosophy), never load-tested against real hardware at real scale in
-- this environment. Hardcoding it means the only way to ever tune it is a new
-- migration + deployment. Moving it into game_config lets it be tuned with a
-- plain UPDATE, based on real production numbers, without a code change.
--
-- Deliberately NOT pinned per-round the way RTP/payout multiplier are: batch
-- size only affects settlement PERFORMANCE, never what a player is actually
-- paid, so there is no fairness reason to lock it to a round -- reading it
-- live on every call is safe and simpler.
--
-- Bounded (100-20000) so a misconfiguration can't break the batching
-- mechanism itself: 0 would make every batch permanently empty (the round
-- would never reach 'settled'); an extreme value would reintroduce the
-- single-giant-transaction problem Issue #42 fixed in the first place.

BEGIN;

ALTER TABLE public.game_config
  ADD COLUMN settle_batch_size INT NOT NULL DEFAULT 3000
    CHECK (settle_batch_size BETWEEN 100 AND 20000);

CREATE OR REPLACE FUNCTION public.settle_round(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round        public.rounds;
  v_s_key        TEXT; v_d_key TEXT; v_t_key TEXT;
  v_batch_size   INT;
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

  SELECT settle_batch_size INTO v_batch_size FROM public.game_config WHERE id = 'global';

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

COMMIT;
