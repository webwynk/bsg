-- Issue #120: apply_bonus_to_current_round() could be executed by anyone who
-- holds the public anon key -- no login, no role check.
--
-- The problem (found by the 2026-10-03 post-migration security advisor run
-- and confirmed against the live database, not assumed):
--   * The function (migration 20260920180000, Issue #99) writes
--     rounds.bonus_multiplier for the round currently in progress, and
--     settle_round() pays every bet as `stake * 9/90/900 * bonus_multiplier`.
--     So whoever can call it can change what the current round pays.
--   * Its body contains no caller check (no auth.uid(), no role lookup); the
--     only guards are "bonus is 1..4" and "round not yet drawn". The superadmin
--     check lives ONLY in the dashboard's server action
--     (applyBonusToCurrentRoundAction -> requireAuth(['superadmin'])), which
--     anyone can bypass by calling /rest/v1/rpc/apply_bonus_to_current_round
--     directly.
--   * The live ACL was {=X/postgres, postgres, anon, authenticated,
--     service_role} -- i.e. EXECUTE for PUBLIC, anon and authenticated. This
--     database's default privileges (ALTER DEFAULT PRIVILEGES ... IN SCHEMA
--     public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role) hand
--     every newly created function to those roles automatically, and the
--     function was created without an explicit REVOKE.
--
-- The fix (Option 1 of the Issue #120 plan): take EXECUTE away from PUBLIC,
-- anon and authenticated, and keep it for service_role. All three must be
-- revoked: anon and authenticated also hold their own explicit grants on top
-- of what they inherit from PUBLIC.
--
-- Why this is safe -- the only legitimate caller is the dashboard, via
-- createAdminClient() (the service-role key) in
-- bsg_web_dashboard/src/app/superadmin/actions.ts, which keeps EXECUTE.
-- bsg_app never calls this function (it only reads rounds.bonus_multiplier
-- of past rounds), and no SQL function, trigger or pg_cron job references it.
-- The function body is deliberately NOT changed: this migration changes who
-- may call it, never what it does. Idempotent: REVOKE/GRANT/COMMENT can be
-- re-run safely.
--
-- Caution for future migrations: CREATE OR REPLACE FUNCTION keeps these
-- grants, but DROP FUNCTION + CREATE FUNCTION would re-trigger the default
-- privileges above and silently hand EXECUTE back to anon/authenticated.
-- If this function is ever dropped and recreated, repeat the REVOKE below.
--
-- Not fixed here (flagged separately per RULE #10): the root cause -- default
-- privileges auto-granting every new function to anon/authenticated -- and a
-- review of the other functions callable by signed-in users.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.apply_bonus_to_current_round(SMALLINT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_bonus_to_current_round(SMALLINT)
  TO service_role;

COMMENT ON FUNCTION public.apply_bonus_to_current_round(SMALLINT) IS
  'Issue #99/#120: sets bonus_multiplier on the round in progress (refused once drawn). Callable by service_role ONLY -- the dashboard calls it through createAdminClient() after requireAuth([''superadmin'']). EXECUTE is revoked from PUBLIC/anon/authenticated; re-apply that REVOKE if this function is ever dropped and recreated.';

COMMIT;
