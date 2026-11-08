-- Undoes 20261107150000_staff_player_money_summary.sql. The function is read-only
-- and nothing in the database depends on it; only the dashboard's Player History
-- page calls it (that page shows an error until the function is back).
BEGIN;
DROP FUNCTION public.staff_player_money_summary(uuid, timestamptz, timestamptz);
COMMIT;
