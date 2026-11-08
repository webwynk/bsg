-- One player's plays, coins bet and coins won per game over a time window, for
-- the Player History page (superadmin and agent), 2026-11-07.
--
-- Why: the page used to load only each game's last 100 plays and add them up in
-- the browser, so "Lifetime" (and any range reaching past those 100 plays) was
-- wrong for active players -- e.g. a house result of -1,02,741 shown where the
-- real lifetime figure was +2,46,918. The database adds the rows up exactly.
--
-- Read-only: it only SELECTs from the four bet tables. Window inclusive at both
-- ends; NULL = no limit on that side. A "play" is one bet row = one player in
-- one round (their phone bets and Print tickets in that round together), the
-- same unit as staff_money_summary. The game keys match staff_money_summary and
-- the dashboard's GAMES list. Server-only: called by the dashboard's service
-- role after requireAuth + ownership checks; players and agents can't call it.
-- Rollback: scripts/staff_player_money_summary_rollback.sql.

BEGIN;

CREATE FUNCTION public.staff_player_money_summary(
  p_user_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH x AS (
    SELECT 'triple_chance'::text AS game, b.total_stake, b.total_payout, b.created_at
      FROM public.bets b WHERE b.user_id = p_user_id
    UNION ALL
    SELECT 'lucky_card'::text, l.total_stake, l.total_payout, l.created_at
      FROM public.lucky_card_bets l WHERE l.user_id = p_user_id
    UNION ALL
    SELECT 'spin2win'::text, w.total_stake, w.total_payout, w.created_at
      FROM public.spin2win_bets w WHERE w.user_id = p_user_id
    UNION ALL
    SELECT 'lucky16'::text, c.total_stake, c.total_payout, c.created_at
      FROM public.lucky16_bets c WHERE c.user_id = p_user_id
  )
  SELECT jsonb_object_agg(g.game, jsonb_build_object(
           'bets',   COALESCE(t.bets, 0),
           'stake',  COALESCE(t.stake, 0),
           'payout', COALESCE(t.payout, 0)))
    FROM (VALUES ('triple_chance'), ('lucky_card'), ('spin2win'), ('lucky16')) AS g(game)
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint                          AS bets,
             COALESCE(sum(x.total_stake), 0)::bigint  AS stake,
             COALESCE(sum(x.total_payout), 0)::bigint AS payout
        FROM x
       WHERE x.game = g.game
         AND (p_from IS NULL OR x.created_at >= p_from)
         AND (p_to   IS NULL OR x.created_at <= p_to)
    ) t ON true;
$function$;

REVOKE ALL ON FUNCTION public.staff_player_money_summary(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_player_money_summary(uuid, timestamptz, timestamptz) TO service_role;

COMMIT;
