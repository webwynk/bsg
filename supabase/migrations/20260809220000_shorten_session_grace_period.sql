-- #############################################################################
-- BSG v2 — Shorten session_grace_sec (Feature 2, Option A baseline)
-- Migration: 20260809220000_shorten_session_grace_period.sql
-- #############################################################################
--
-- 90s was generous enough that a device which simply closed the app (no
-- explicit logout -- confirmed the app has zero lifecycle hooks calling
-- session_logout) left a second device waiting up to a minute and a half
-- to get in. 30s = two full 15s heartbeat cycles of tolerance, comfortably
-- above one delayed/dropped beat, while being 3x shorter than before. This
-- is the safety-net floor for whatever the new app-lifecycle release (Part
-- 1, bsg_app) can't catch -- primarily a hard force-kill on iOS, which the
-- OS gives no reliable chance to run any cleanup code for at all.
-- #############################################################################

BEGIN;

UPDATE public.game_config SET session_grace_sec = 30 WHERE id = 'global';
ALTER TABLE public.game_config ALTER COLUMN session_grace_sec SET DEFAULT 30;

COMMIT;
