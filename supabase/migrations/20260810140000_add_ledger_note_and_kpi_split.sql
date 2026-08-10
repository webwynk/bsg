-- User-requested feature: superadmin can attach a reason/note when crediting
-- or debiting an agent's coins, visible on the ledger/history pages -- for a
-- real-money platform, "why was 50 coins taken back?" needs a real answer
-- next to the number, not just an audit_log line nobody thinks to check.
--
-- Also splits the KPI math the dashboard will read: previously
-- getSystemOverviewMetricsAction computed one netted "Today Issued" number.
-- The new UI wants two separate, non-netted numbers (Today Deposited /
-- Today Withdrawn), which is purely a read-side aggregation change -- no
-- schema change needed for that part, noted here for context only.

BEGIN;

ALTER TABLE public.coin_ledger ADD COLUMN note TEXT CHECK (char_length(note) <= 500);

-- apply_coin_movement: add an optional note, defaulting to NULL so every
-- existing caller (place_bet, settle_round, agent_transfer_coins, and
-- admin_issue_coins itself until updated below) is completely unaffected.
CREATE OR REPLACE FUNCTION public.apply_coin_movement(
  p_user_id         UUID,
  p_counterparty_id UUID,
  p_kind            TEXT,
  p_amount          BIGINT,
  p_round_id        UUID DEFAULT NULL,
  p_note            TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'Coin movement must be non-zero' USING errcode = 'P0110';
  END IF;

  SELECT coin_balance INTO v_balance
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found' USING errcode = 'P0111';
  END IF;

  IF v_balance + p_amount < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_COINS' USING errcode = 'P0112';
  END IF;

  UPDATE public.profiles
     SET coin_balance   = coin_balance + p_amount,
         ledger_version = ledger_version + 1,
         updated_at     = NOW()
   WHERE id = p_user_id
   RETURNING coin_balance INTO v_balance;

  INSERT INTO public.coin_ledger
    (user_id, counterparty_id, kind, amount, balance_after, round_id, note)
  VALUES
    (p_user_id, p_counterparty_id, p_kind, p_amount, v_balance, p_round_id, p_note);

  RETURN v_balance;
END;
$$;

-- admin_issue_coins: accepts an optional reason, forwarded to
-- apply_coin_movement's new p_note. Signature grows by one DEFAULT NULL
-- parameter -- existing callers that don't pass it are unaffected.
CREATE OR REPLACE FUNCTION public.admin_issue_coins(
  p_agent_id  UUID,
  p_amount    BIGINT,
  p_direction TEXT,          -- 'credit' | 'debit'
  p_reason    TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_role   TEXT;
  v_active BOOLEAN;
  v_agent  public.profiles;
  v_bal    BIGINT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be a positive whole number' USING errcode = 'P0130';
  END IF;
  IF p_direction NOT IN ('credit','debit') THEN
    RAISE EXCEPTION 'direction must be credit or debit' USING errcode = 'P0131';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS NULL OR v_active IS NOT TRUE OR v_role <> 'superadmin' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SUPERADMIN_ONLY' USING errcode = 'P0135';
  END IF;

  SELECT * INTO v_agent FROM public.profiles WHERE id = p_agent_id;
  IF NOT FOUND OR v_agent.role <> 'agent' THEN
    RAISE EXCEPTION 'Agent not found' USING errcode = 'P0136';
  END IF;

  v_bal := public.apply_coin_movement(
    p_agent_id, v_caller,
    CASE WHEN p_direction = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END,
    CASE WHEN p_direction = 'credit' THEN p_amount ELSE -p_amount END,
    NULL, p_reason);

  INSERT INTO public.audit_log (actor_id, kind, detail)
  VALUES (v_caller, 'coin',
    format('%s %s coins %s agent @%s%s',
      initcap(p_direction), p_amount,
      CASE WHEN p_direction='credit' THEN 'to' ELSE 'from' END, v_agent.username,
      CASE WHEN p_reason IS NOT NULL AND p_reason <> '' THEN format(' (%s)', p_reason) ELSE '' END));

  RETURN jsonb_build_object('success', true, 'agent_coin_balance', v_bal);
END;
$$;

COMMIT;
