-- Follow-up to 20260810140000_add_ledger_note_and_kpi_split.sql.
--
-- Verified live (not assumed) immediately after applying that migration:
-- CREATE OR REPLACE FUNCTION cannot change a function's parameter list --
-- adding p_reason did not replace admin_issue_coins(uuid,bigint,text), it
-- created a SECOND, separate overload alongside it,
-- admin_issue_coins(uuid,bigint,text,text). Two real problems, both
-- confirmed live via pg_proc/pg_proc ACL inspection:
--
--   1. The new 4-arg overload is a newly-created function, so Postgres
--      auto-granted it EXECUTE to PUBLIC (and therefore anon) -- the exact
--      gotcha already documented elsewhere in this project's migrations.
--      A real-money coin-issuance function briefly had anon-callable EXECUTE.
--      auth.uid() being NULL for a true anon caller means the RPC's own
--      "Unauthenticated" check would still reject it, but this is real
--      defense-in-depth we should not leave open.
--   2. Two overloads (3-arg and 4-arg) both exist and are both valid
--      candidates for a 3-named-argument PostgREST call, which risks
--      "could not choose a best candidate function" at call time, or an
--      ambiguous resolution -- not a safe state to leave live.
--
-- Fix: drop the old 3-arg overload entirely (its replacement, the 4-arg
-- version with p_reason DEFAULT NULL, is fully backward compatible with
-- every existing 3-argument call site), then explicitly lock down the
-- remaining function's grants to authenticated only.
--
-- The SAME thing happened to apply_coin_movement (also extended with a new
-- parameter in the prior migration) -- and it is materially worse there:
-- apply_coin_movement performs NO caller-identity check of its own at all.
-- It trusts whatever calls it completely, relying entirely on place_bet /
-- settle_round / agent_transfer_coins / admin_issue_coins to have already
-- authorized the caller before reaching it. Its original grants were
-- postgres + service_role ONLY -- deliberately not even `authenticated` --
-- and the new 6-arg overload was auto-granted to anon AND authenticated.
-- Left as-is, this would let anyone with just the public anon key call
-- apply_coin_movement directly and move arbitrary coins for any account,
-- completely bypassing every authorization check in the system. Fixed the
-- same way: drop the old 5-arg overload, lock the 6-arg one's grants back
-- down to exactly what the original had.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_issue_coins(UUID, BIGINT, TEXT);

REVOKE ALL ON FUNCTION public.admin_issue_coins(UUID, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_issue_coins(UUID, BIGINT, TEXT, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.apply_coin_movement(UUID, UUID, TEXT, BIGINT, UUID);

REVOKE ALL ON FUNCTION public.apply_coin_movement(UUID, UUID, TEXT, BIGINT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
-- Deliberately NOT granted to authenticated -- matches the original's
-- postgres/service_role-only exposure. Every legitimate caller is itself a
-- SECURITY DEFINER function owned by the same role, which does not need a
-- separate grant to call another SECURITY DEFINER function it was defined
-- alongside.

COMMIT;
