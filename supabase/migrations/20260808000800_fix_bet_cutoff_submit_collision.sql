-- Amends Issue #4 (20260808000600_restore_bet_cutoff_margin.sql).
--
-- Found by live manual testing: after that migration set bet_cutoff_second to
-- 85, real bets started being rejected with ROUND_CLOSED and refunded, even
-- when placed well before the 85-second mark.
--
-- Root cause, confirmed by reading the app's actual submission code
-- (bsg_app/lib/providers/game_provider.dart): chips placed on the board are
-- NOT sent to the server as they're tapped. The app batches everything and
-- fires ONE place_bet call for the whole board at a single fixed moment: when
-- its on-screen countdown reaches "05". The app's countdown is calculated as
-- (90 - seconds_into_round), so countdown "05" is the app firing its one and
-- only submission at seconds_into_round = 85 -- the exact same instant
-- bet_cutoff_second was just set to.
--
-- Before this fix, place_bet's cutoff was draw_at_second (90), so that
-- 85-second batch-send had a working 5-second cushion to reach and be
-- processed by the server. Setting bet_cutoff_second to 85 collapsed that
-- cushion to zero: any real network/processing latency between the app
-- firing the request at second 85 and the server evaluating it pushes the
-- server's clock past 85, so the very bets the app is designed to submit at
-- that moment get rejected.
--
-- This does not touch the app (it still sends its one batch at second 85 --
-- that is a separate, larger fix tracked for a future release). This
-- migration only restores a real margin on the server side: moving the
-- cutoff to 88 gives that fixed 85-second submission ~3 seconds to land
-- before rejection, while still preserving a genuine 2-second gap before the
-- draw at 90 (game_config_cutoff_before_draw still enforces cutoff < draw).

UPDATE public.game_config SET bet_cutoff_second = 88 WHERE id = 'global';

ALTER TABLE public.game_config ALTER COLUMN bet_cutoff_second SET DEFAULT 88;
