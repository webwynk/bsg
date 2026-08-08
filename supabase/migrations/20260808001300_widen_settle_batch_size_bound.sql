-- Amends 20260808001200_make_settle_batch_size_tunable.sql.
--
-- Found immediately while verifying that migration: its lower bound (100)
-- was too conservative. It blocks a legitimate use case -- deliberately
-- setting a small batch size to test/observe multi-batch draining behavior
-- against a small number of real accounts (exactly what was being done when
-- this was caught). The only value that actually needs to stay forbidden is
-- 0, which would make every batch permanently empty and a round would never
-- reach 'settled'.

BEGIN;

ALTER TABLE public.game_config DROP CONSTRAINT game_config_settle_batch_size_check;
ALTER TABLE public.game_config
  ADD CONSTRAINT game_config_settle_batch_size_check CHECK (settle_batch_size BETWEEN 1 AND 20000);

COMMIT;
