-- Update constraint and set draw_at_second to 90 in game_config so server draw happens
-- at exact second 90 of 103s cycle (matching countdown 90 -> 00).
-- 0..85s: betting (countdown 90 -> 05)
-- 85s: boards lock, "no more bets", bet submitted (countdown 05)
-- 85..90s: grace/transmission window (countdown 05 -> 00)
-- 90s: server draw, wheel spins instantly at countdown 00

ALTER TABLE public.game_config DROP CONSTRAINT IF EXISTS game_config_draw_at_second_check;
ALTER TABLE public.game_config ADD CONSTRAINT game_config_draw_at_second_check CHECK (draw_at_second BETWEEN 85 AND 102);

UPDATE public.game_config SET draw_at_second = 90 WHERE id = 'global';
