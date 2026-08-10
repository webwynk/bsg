-- Issue #6 (MASTER_AUDIT_AND_REMEDIATION_PLAN.md): coin_ledger's admin_credit/
-- admin_debit tags are overloaded. agent_transfer_coins() writes them for the
-- agent's OWN balance side-effect of a player transfer, and admin_issue_coins()
-- writes the identical tags for genuine superadmin -> agent issuance. Nothing
-- distinguishes the two on read, so:
--   - superadmin's "Today Issued" KPI (getSystemOverviewMetricsAction) counts
--     agent-initiated player transfers as if the superadmin had issued them
--   - the "Coins Issued Ledger" page (getAgentCoinLedgerAction) -- whose own
--     subtitle claims to be an exclusive superadmin audit trail -- shows the
--     same agent transfers
--   - every agent's own transaction history (getAgentTransactionHistoryAction)
--     shows each player transfer TWICE: once correctly, once again mislabeled
--     "SuperAdmin", because its own comment assumes "a movement on my own
--     balance came from the SuperAdmin" -- true when this schema was written,
--     no longer true once agent_transfer_coins started using the same tags.
--
-- Fix: split the tag. agent_credit/agent_debit (the player-facing side of a
-- transfer) are unaffected. admin_credit/admin_debit are henceforth written
-- ONLY by admin_issue_coins (genuine superadmin issuance). The agent's own
-- mirrored balance row from a player transfer gets a new, distinct tag --
-- agent_ledger_credit/agent_ledger_debit -- so every existing read site that
-- already filters on admin_credit/admin_debit becomes correct automatically,
-- by construction, with no query logic change required there.

BEGIN;

ALTER TABLE public.coin_ledger DROP CONSTRAINT coin_ledger_kind_check;
ALTER TABLE public.coin_ledger ADD CONSTRAINT coin_ledger_kind_check CHECK (kind IN (
  'stake', 'stake_refund', 'payout',
  'agent_credit', 'agent_debit',                 -- agent <-> player (unchanged)
  'agent_ledger_credit', 'agent_ledger_debit',    -- agent's own mirrored row from a player transfer (was admin_credit/admin_debit)
  'admin_credit', 'admin_debit'                   -- superadmin <-> agent ONLY, now unambiguous
));

ALTER TABLE public.coin_ledger DROP CONSTRAINT ledger_sign_matches_kind;
ALTER TABLE public.coin_ledger ADD CONSTRAINT ledger_sign_matches_kind CHECK (
  (kind IN ('payout','stake_refund','agent_credit','admin_credit','agent_ledger_credit') AND amount > 0) OR
  (kind IN ('stake','agent_debit','admin_debit','agent_ledger_debit')                     AND amount < 0)
);

-- Re-point agent_transfer_coins' own-side entries at the new, unambiguous
-- tag. Everything else (auth checks, error codes) is unchanged from the live
-- version in 20260808000000_fix_blocked_account_coin_bypass.sql -- this is a
-- CREATE OR REPLACE with the same signature, only the two 'admin_*' literals
-- on the agent's own apply_coin_movement calls change.
CREATE OR REPLACE FUNCTION public.agent_transfer_coins(
  p_player_id UUID,
  p_amount    BIGINT,
  p_direction TEXT           -- 'credit' (agent->player) | 'debit' (player->agent)
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller  UUID := auth.uid();
  v_role    TEXT;
  v_active  BOOLEAN;
  v_player  public.profiles;
  v_agent   UUID;
  v_pbal BIGINT; v_abal BIGINT;
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
  IF v_role IS NULL OR v_active IS NOT TRUE OR v_role NOT IN ('agent','superadmin') THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING errcode = 'P0132';
  END IF;

  SELECT * INTO v_player FROM public.profiles WHERE id = p_player_id;
  IF NOT FOUND OR v_player.role <> 'player' THEN
    RAISE EXCEPTION 'Player not found' USING errcode = 'P0133';
  END IF;

  -- An agent may only move coins for their own players.
  IF v_role = 'agent' AND v_player.agent_id <> v_caller THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NOT_YOUR_PLAYER' USING errcode = 'P0134';
  END IF;
  v_agent := v_player.agent_id;

  IF p_direction = 'credit' THEN
    v_abal := public.apply_coin_movement(v_agent,     p_player_id, 'agent_ledger_debit',  -p_amount);
    v_pbal := public.apply_coin_movement(p_player_id, v_agent,     'agent_credit',         p_amount);
  ELSE
    v_pbal := public.apply_coin_movement(p_player_id, v_agent,     'agent_debit',         -p_amount);
    v_abal := public.apply_coin_movement(v_agent,     p_player_id, 'agent_ledger_credit',  p_amount);
  END IF;

  RETURN jsonb_build_object('success', true,
    'player_coin_balance', v_pbal, 'agent_coin_balance', v_abal);
END;
$$;

-- admin_issue_coins is untouched -- its admin_credit/admin_debit writes are
-- now, by construction, exclusively genuine superadmin issuance.

COMMIT;
