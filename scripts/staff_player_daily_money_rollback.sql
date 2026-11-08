-- Undoes 20261108100000_staff_player_daily_money.sql. The function is read-only
-- and nothing in the database depends on it; only the dashboard's P&L Audit tab
-- calls it (that tab shows an error until the function is back).
BEGIN;
DROP FUNCTION public.staff_player_daily_money(uuid, timestamptz, timestamptz);
COMMIT;
