-- #############################################################################
-- BSG v2 — Drop mark_notification_read (confirmed unused)
-- Migration: 20260809180000_drop_unused_mark_notification_read.sql
-- #############################################################################
--
-- Built in 20260809150000 for a client authenticated as the agent's own JWT
-- (auth.uid() = that agent). While implementing the dashboard side (Step 3 of
-- Issue #52), this project's actual convention turned out to be: every
-- dashboard Server Action uses the service-role admin client with explicit
-- scoping in TypeScript (see getPlayersAction, setPlayerActiveAction, etc in
-- agent/players/actions.ts), not a user-context client relying on RLS. Called
-- via the admin client, auth.uid() is NULL, so this function would always
-- raise "Unauthenticated" -- it can never actually be invoked as designed by
-- the code that exists. markNotificationReadAction() uses a direct, scoped
-- admin-client UPDATE instead, matching the rest of the file. No caller of
-- this function was ever shipped, so dropping it rather than leaving
-- confirmed-dead code in the schema.
-- #############################################################################

BEGIN;

DROP FUNCTION IF EXISTS public.mark_notification_read(UUID);

COMMIT;
