-- #############################################################################
-- LUCKY CARD - GAME FUNCTIONS 2 of 6: SETTLEMENT
-- Migration: 20261005100000_lucky_card_settle_round.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 4 (payout), 5 (bonus), 14.4, 14.14 (batching)
-- #############################################################################
--
-- PURELY ADDITIVE. Creates one new function. Nothing belonging to Triple
-- Chance is altered, dropped, replaced or called; settle_round() is untouched.
--
-- WHAT IT DOES
-- ------------
-- Scores and pays ONE BOUNDED BATCH of a drawn round's unsettled bets, then
-- returns. A bet's payout is
--
--     stake on the winning card  x  10  x  the round's own bonus_multiplier
--
-- and only the exact winning card pays (spec 3, Q24). The bonus multiplier is
-- the value pinned on the round at creation (spec 5), applied here and only
-- here: the draw never sees it.
--
-- BATCHING - mirrors Triple Chance's live settle_round()
-- ------------------------------------------------------
-- The user asked that coin updates not all happen at once. One call handles at
-- most lucky_card_config.settle_batch_size bets with set-based SQL. The round
-- is marked 'settled' only when a call finds FEWER bets than the batch size;
-- until then the next cron tick or client poll calls again and takes the next
-- batch. Each call is its own transaction, so a failure rolls back only that
-- batch, and the NOT is_settled filter makes a repeat call safe - no bet can be
-- paid twice. (If the bet count is an exact multiple of the batch size, one
-- extra call finds zero bets and closes the round. Same as Triple Chance.)
--
-- MONEY PATH
-- ----------
-- Like settle_round(), winners are paid by one set-based UPDATE of profiles
-- feeding one INSERT into coin_ledger, not by calling the per-row movement
-- function once per winner (which is what made Triple Chance's original
-- settlement too slow, see 20260808000900_batch_settle_round_payouts.sql).
-- The ledger row is written from the balance UPDATE's own RETURNING output, so
-- balance_after can never disagree with the balance actually stored.
--   * kind = 'payout', lucky_card_round_id = the round, round_id = NULL -
--     exactly what the ledger_game_has_round constraint requires.
--   * Losing bets are scored and marked settled but write no ledger row:
--     coin_ledger rejects a zero amount.
--   * lucky_card_bets allows one row per player per round, so no account can
--     appear twice in a batch.
-- #############################################################################

BEGIN;

CREATE FUNCTION public.lucky_card_settle_round(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_round       public.lucky_card_rounds;
  v_card        TEXT;
  v_batch_size  INT;
  v_batch_count INT;
  v_batch_paid  BIGINT;
BEGIN
  SELECT settle_batch_size INTO v_batch_size FROM public.lucky_card_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.lucky_card_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.winning_rank IS NULL THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'not_drawn');
  END IF;

  IF v_round.phase = 'settled' THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'already_settled');
  END IF;

  v_card := v_round.winning_rank || '_' || v_round.winning_suit;

  WITH batch AS (
    SELECT id,
           CASE v_card
             WHEN 'J_hearts'   THEN j_hearts   WHEN 'J_spades' THEN j_spades
             WHEN 'J_diamonds' THEN j_diamonds WHEN 'J_clubs'  THEN j_clubs
             WHEN 'Q_hearts'   THEN q_hearts   WHEN 'Q_spades' THEN q_spades
             WHEN 'Q_diamonds' THEN q_diamonds WHEN 'Q_clubs'  THEN q_clubs
             WHEN 'K_hearts'   THEN k_hearts   WHEN 'K_spades' THEN k_spades
             WHEN 'K_diamonds' THEN k_diamonds WHEN 'K_clubs'  THEN k_clubs
           END AS win_stake
      FROM public.lucky_card_bets
     WHERE round_id = p_round_id AND NOT is_settled
     ORDER BY id
     LIMIT v_batch_size
     FOR UPDATE
  ),
  computed AS (
    SELECT id, (win_stake * 10 * v_round.bonus_multiplier)::BIGINT AS pay
      FROM batch
  ),
  scored AS (
    UPDATE public.lucky_card_bets b
       SET total_payout = computed.pay,
           is_settled   = true,
           settled_at   = NOW()
      FROM computed
     WHERE b.id = computed.id
    RETURNING b.user_id, computed.pay AS total_payout
  ),
  winners AS (
    SELECT user_id, total_payout FROM scored WHERE total_payout > 0
  ),
  paid AS (
    UPDATE public.profiles p
       SET coin_balance   = p.coin_balance + winners.total_payout,
           ledger_version = p.ledger_version + 1,
           updated_at     = NOW()
      FROM winners
     WHERE p.id = winners.user_id
    RETURNING p.id AS user_id, p.coin_balance AS new_balance, winners.total_payout
  ),
  ledgered AS (
    INSERT INTO public.coin_ledger (user_id, counterparty_id, kind, amount, balance_after, lucky_card_round_id)
    SELECT user_id, NULL, 'payout', total_payout, new_balance, p_round_id
      FROM paid
    RETURNING amount
  )
  SELECT (SELECT count(*) FROM scored),
         COALESCE((SELECT sum(amount) FROM ledgered), 0)
    INTO v_batch_count, v_batch_paid;

  UPDATE public.lucky_card_rounds
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
$fn$;

-- Internal: service_role only, mirroring settle_round()'s live ACL. Default
-- privileges here would otherwise grant EXECUTE to anon and authenticated
-- (Issue #120), and a client able to call this could force settlement.
-- CREATE OR REPLACE keeps these grants; DROP + CREATE does not.
REVOKE ALL ON FUNCTION public.lucky_card_settle_round(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lucky_card_settle_round(UUID) TO service_role;

COMMENT ON FUNCTION public.lucky_card_settle_round(UUID) IS
  'Scores and pays one bounded batch of a drawn Lucky Card round: stake on the '
  'winning card x 10 x the round''s pinned bonus multiplier. Call repeatedly '
  'until fully_settled; repeats never double-pay. Internal; service_role only.';

COMMIT;
