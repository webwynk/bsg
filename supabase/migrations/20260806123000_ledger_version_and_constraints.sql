-- =============================================================================
-- FIX: LEDGER VERSIONING + LEDGER INTEGRITY CONSTRAINTS
-- Migration: 20260806123000_ledger_version_and_constraints.sql
-- Covers mismatches M-5 (ledger_version unused), M-2 (fractional coins),
--                   M-4 (transaction type vocabulary)
-- =============================================================================
--
-- Pre-flight checks run against production before writing this file:
--   * profiles: 0 of 11 rows had a fractional balance
--   * transactions: 0 of 25 rows had a fractional amount
--   * transactions.type contained exactly the 5 expected values
--     (bet_stake, win_payout, agent_topup, agent_deduct, admin_adjustment)
-- so every constraint below validates against existing data without a backfill.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. M-5 — expose ledger_version so the client can order balance updates
-- ─────────────────────────────────────────────────────────────────────────────
-- profiles.ledger_version is incremented by submit_round_bet,
-- resolve_round_payouts and get_my_round_result, and submit_round_bet already
-- returns it -- but nothing else did, so the Flutter client had no way to tell a
-- stale heartbeat from a fresh one. It compensated with a pair of blunt global
-- locks (holdHeartbeatBalance / suspendHeartbeatPolling) whose early-return
-- paths could leak and freeze the displayed balance for the rest of the process.
--
-- Returning the version from the heartbeat and the round-result call lets the
-- client simply ignore any response older than what it has already applied.

CREATE OR REPLACE FUNCTION public.update_user_heartbeat(
  p_user_id       UUID,
  p_session_token TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_active BOOLEAN;
  v_balance   NUMERIC;
  v_token     TEXT;
  v_version   BIGINT;
BEGIN
  SELECT is_active, balance, ledger_version
    INTO v_is_active, v_balance, v_version
    FROM public.profiles WHERE id = p_user_id;

  IF NOT FOUND OR NOT v_is_active THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'account_blocked');
  END IF;

  SELECT session_token INTO v_token FROM public.active_sessions WHERE user_id = p_user_id;
  IF v_token IS NULL OR v_token != p_session_token THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'session_displaced');
  END IF;

  UPDATE public.active_sessions SET last_seen_at = NOW() WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'allowed',        true,
    'balance',        v_balance,
    'ledger_version', COALESCE(v_version, 0)   -- M-5
  );
END;
$$;


-- get_my_round_result has five separate RETURN points and performs settlement
-- (credits the win, writes the payout transaction). It is deliberately NOT
-- rewritten here -- a wrapper adds the version without touching money logic.
-- The version is read after the inner call, so it reflects any credit just made.

CREATE OR REPLACE FUNCTION public.get_my_round_result_v2(p_round_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result  jsonb;
  v_version BIGINT;
BEGIN
  v_result := public.get_my_round_result(p_round_id);
  SELECT ledger_version INTO v_version FROM public.profiles WHERE id = auth.uid();
  RETURN v_result || jsonb_build_object('ledger_version', COALESCE(v_version, 0));
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. M-2 — coins are whole units
-- ─────────────────────────────────────────────────────────────────────────────
-- transferPointsAction accepted two decimal places (Math.round(x*100)/100) and
-- profiles.balance is NUMERIC, but the Flutter client parses balance with
-- .toInt() at every boundary. A 100.75 deposit displayed as 100 in the app and
-- the remainder could never be bet or withdrawn. The cashier now floors input;
-- these constraints stop any other path reintroducing a fraction.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_balance_whole_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_balance_whole_check
  CHECK (balance = trunc(balance));

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_amount_whole_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_amount_whole_check
  CHECK (amount = trunc(amount) AND balance_after = trunc(balance_after));


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. M-4 — one transaction-type vocabulary
-- ─────────────────────────────────────────────────────────────────────────────
-- Three clients maintained three different lists between them referencing nine
-- values no RPC has ever written (admin_topup, game_bet, game_win, agent_credit,
-- agent_debit, deposit, withdraw, win_credit). Pin the column to what the
-- database actually produces so a typo fails loudly instead of silently
-- dropping rows from a filter.

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'bet_stake',         -- submit_round_bet
    'win_payout',        -- resolve_round_payouts, get_my_round_result
    'agent_topup',       -- transfer_coins_agent_to_player, agent_topup_player
    'agent_deduct',      -- withdraw_coins_player_to_agent, agent_deduct_player
    'admin_adjustment'   -- issue_agent_coins
  ));


NOTIFY pgrst, 'reload schema';
