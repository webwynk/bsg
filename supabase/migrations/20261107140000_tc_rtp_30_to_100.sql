-- Triple Chance: allow RTP 30 to 100 (was 50 to 100).
--
-- Only the two RTP rules change. The draw (draw_round, "closest to target", as
-- before 2026-11-06) is untouched: it computes target = round stake x RTP / 100
-- and picks the result whose payout is closest, which works the same at any
-- setting; nothing in it, in settle_round, or in the round creation
-- (get_current_round / tick_rounds copy game_config.rtp_percentage into the new
-- round) assumes 50 or more (audited 2026-11-07, see
-- docs/rtp_audit/TRIPLE_CHANCE_30_100_PLAN.md).
--
-- The 30 floor matches Spin2Win, Lucky Card and Lucky 16. Rollback:
-- scripts/tc_rtp_30_to_100_rollback.sql. Apply between rounds.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.game_config DROP CONSTRAINT game_config_rtp_percentage_check;
ALTER TABLE public.game_config ADD CONSTRAINT game_config_rtp_percentage_check
  CHECK (rtp_percentage >= 30 AND rtp_percentage <= 100);

ALTER TABLE public.rounds DROP CONSTRAINT rounds_rtp_percentage_check;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_rtp_percentage_check
  CHECK (rtp_percentage >= 30 AND rtp_percentage <= 100);

COMMIT;
