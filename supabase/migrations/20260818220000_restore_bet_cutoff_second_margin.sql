-- BSG v2 — Restore game_config.bet_cutoff_second to 85
--
-- Context: Issue #4 originally set this to 85 (a deliberate 5-second safety
-- margin ahead of draw_at_second = 90), matching bsg_app's own hardcoded
-- "no more bets" countdown threshold (client stops accepting input at
-- countdown == 5, which corresponds exactly to seconds_into_round == 85).
--
-- Found during RULE #19's 2026-08-18 deep re-audit of bsg_app: the live
-- value had silently drifted to 88 (updated_at 2026-08-17T13:07:56Z) — no
-- audit_log entry, and bsg_web_dashboard has no admin field for this column
-- at all, so the change did not go through any tracked admin action. This
-- shrank the real safety margin from 5 seconds to 2 without bsg_app's
-- knowledge (it has no live source of truth for this value — get_current_round()
-- returns draw_at_second but never bet_cutoff_second).
--
-- User-confirmed decision (not a silent revert): keep the app's existing
-- 5-second countdown behavior exactly as-is, and correct the database to
-- match it, rather than changing bsg_app to read this value live. A
-- structural fix (exposing bet_cutoff_second via get_current_round() and a
-- real dashboard control) remains a separate, not-yet-scoped follow-up if
-- ever wanted later.
--
-- No application code changes required by this migration.

BEGIN;

UPDATE public.game_config
   SET bet_cutoff_second = 85
 WHERE id = 'global';

COMMIT;
