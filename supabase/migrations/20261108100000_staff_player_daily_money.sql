-- One player's plays, coins bet and coins won PER INDIA (IST) DAY, for the P&L
-- Audit tab on the superadmin agent page (selected player), 2026-11-08.
--
-- Read-only: it only SELECTs from the four bet tables (all games; phone bets
-- and Print tickets of a round are one bet row, as everywhere else). A row's
-- day is the IST calendar day of the bet: UTC time + 05:30 (India has no
-- daylight saving, so a fixed offset is exact and needs no time-zone data), so a
-- day runs 00:00:00 to 23:59:59.999 IST. The window is
-- inclusive at both ends; NULL = no limit on that side. Only days with at
-- least one play are returned, newest first. Server-only: called by the
-- dashboard's service role after requireAuth; players and agents can't call it.
-- Rollback: scripts/staff_player_daily_money_rollback.sql.

BEGIN;

CREATE FUNCTION public.staff_player_daily_money(
  p_user_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
 RETURNS TABLE(day date, plays bigint, stake bigint, payout bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ((x.created_at AT TIME ZONE 'UTC') + INTERVAL '5 hours 30 minutes')::date AS day,
         count(*)::bigint                           AS plays,
         COALESCE(sum(x.total_stake), 0)::bigint   AS stake,
         COALESCE(sum(x.total_payout), 0)::bigint  AS payout
    FROM (
      SELECT b.total_stake, b.total_payout, b.created_at FROM public.bets b WHERE b.user_id = p_user_id
      UNION ALL
      SELECT l.total_stake, l.total_payout, l.created_at FROM public.lucky_card_bets l WHERE l.user_id = p_user_id
      UNION ALL
      SELECT w.total_stake, w.total_payout, w.created_at FROM public.spin2win_bets w WHERE w.user_id = p_user_id
      UNION ALL
      SELECT c.total_stake, c.total_payout, c.created_at FROM public.lucky16_bets c WHERE c.user_id = p_user_id
    ) x
   WHERE (p_from IS NULL OR x.created_at >= p_from)
     AND (p_to   IS NULL OR x.created_at <= p_to)
   GROUP BY 1
   ORDER BY 1 DESC;
$function$;

REVOKE ALL ON FUNCTION public.staff_player_daily_money(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_player_daily_money(uuid, timestamptz, timestamptz) TO service_role;

COMMIT;
