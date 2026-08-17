-- Reverts 20260818220000_restore_bet_cutoff_second_margin.sql.
--
-- That migration set bet_cutoff_second back to 85, reasoning that it should
-- match bsg_app's hardcoded "countdown == 5" assumption. That reasoning was
-- wrong: 85 was never the intended value. It was Issue #4's *original*
-- 2026-08-08 setting, which a same-day follow-up migration
-- (20260808000800_fix_bet_cutoff_submit_collision.sql) deliberately moved to
-- 88 after live manual testing showed 85 caused real player bets to be
-- wrongly rejected with ROUND_CLOSED and refunded. Root cause: bsg_app
-- batches all bets into one place_bet call fired at the exact instant its
-- countdown reaches "05" (seconds_into_round == 85). A server cutoff of
-- exactly 85 leaves that fixed-timing submission zero margin for ordinary
-- network/processing latency. 88 restores a real ~3-second cushion for that
-- submission to land, while game_config_cutoff_before_draw still guarantees
-- at least 2 seconds of margin before the draw at 90.
--
-- This was missed during the 2026-08-18 RULE #19 re-audit because that
-- session's live-database check only read the *current* value (88) and
-- flagged it as unexplained drift from 85, without reading every migration
-- that had touched this column -- specifically missing this one, which
-- documents 88 as the deliberate, tested fix, not the drift.
--
-- No application code changes required by this migration. The underlying
-- gap this whole episode exposes -- bsg_app has no live source of truth for
-- bet_cutoff_second, and its fixed "submit at second 85" timing is itself
-- the thing colliding with any value chosen here -- remains open, undecided,
-- and is real follow-up work for bsg_app, not something this migration
-- attempts to close.

BEGIN;

UPDATE public.game_config
   SET bet_cutoff_second = 88
 WHERE id = 'global';

ALTER TABLE public.game_config ALTER COLUMN bet_cutoff_second SET DEFAULT 88;

COMMIT;
