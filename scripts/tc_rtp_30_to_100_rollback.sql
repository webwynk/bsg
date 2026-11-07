-- Undoes 20261107140000_tc_rtp_30_to_100.sql: Triple Chance RTP back to 50 to 100.
--
-- Stops without changing anything if the setting or any round is below 50,
-- because the 50-to-100 rule would reject it (raise the setting to 50 or more
-- first; rounds already played below 50 keep their real setting, so the
-- rollback is then refused rather than rewriting history). Apply between rounds.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_config WHERE rtp_percentage < 50)
     OR EXISTS (SELECT 1 FROM public.rounds WHERE rtp_percentage < 50) THEN
    RAISE EXCEPTION 'A Triple Chance setting or round is below 50%%; not rolling back';
  END IF;
END;
$chk$;

ALTER TABLE public.game_config DROP CONSTRAINT game_config_rtp_percentage_check;
ALTER TABLE public.game_config ADD CONSTRAINT game_config_rtp_percentage_check
  CHECK (rtp_percentage >= 50 AND rtp_percentage <= 100);

ALTER TABLE public.rounds DROP CONSTRAINT rounds_rtp_percentage_check;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_rtp_percentage_check
  CHECK (rtp_percentage >= 50 AND rtp_percentage <= 100);

COMMIT;
