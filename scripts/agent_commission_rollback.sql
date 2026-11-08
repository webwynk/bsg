-- Rollback for supabase/migrations/20261108120000_agent_commission.sql.
-- Removes the commission feature from the database: the 3 functions and the
-- rate history table. Bets, balances and the coin ledger were never touched by
-- it, so nothing else needs undoing. The audit_log rows of past changes stay.
--
-- SAFETY: refuses while any rate rows exist (it would delete the history of
-- what % each agent had). To remove anyway, run the DROP lines by hand after
-- exporting agent_commission_rates.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.agent_commission_rates') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.agent_commission_rates) THEN
    RAISE EXCEPTION 'agent_commission_rates has rows: export them first, then drop by hand.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.staff_agent_commission_history(uuid, integer);
DROP FUNCTION IF EXISTS public.staff_agent_commission_report(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.set_agent_commission(uuid, uuid, numeric);
DROP TABLE IF EXISTS public.agent_commission_rates;

COMMIT;
