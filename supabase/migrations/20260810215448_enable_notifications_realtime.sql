-- #############################################################################
-- BSG v2 — Enable Realtime for public.notifications
-- Migration: 20260811060000_enable_notifications_realtime.sql
-- #############################################################################
--
-- Replaces AgentNotificationsProvider's 15-second polling loop with a push-
-- based Realtime subscription -- confirmed live that Realtime was not
-- enabled for ANY table in this project before this migration (empty
-- pg_publication_tables for supabase_realtime).
--
-- No RLS change: the existing notifications_select policy already lets an
-- agent see only their own agent_id and lets a superadmin see every row
-- (superadmin's narrower "staff lockouts only" scoping happens in
-- getAgentNotificationsAction's own query filter, .is('agent_id', null) --
-- an application-level filter, not RLS). Realtime enforces RLS on top of
-- whatever filter the subscribing client specifies, so the client-side
-- subscription itself must pass the equivalent filter (agent_id=is.null for
-- superadmin, agent_id=eq.<their id> for an agent) to preserve that same
-- scoping -- this migration only turns the underlying capability on.
-- #############################################################################

BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

COMMIT;
