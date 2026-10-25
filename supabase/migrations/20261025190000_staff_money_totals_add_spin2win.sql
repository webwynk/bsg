-- #############################################################################
-- STAFF MONEY TOTALS: add Spin2Win to the two staff money functions
-- Migration: 20261025190000_staff_money_totals_add_spin2win.sql
-- Spin2Win build plan step 17 (approved by Hasan 2026-10-25)
-- #############################################################################
--
-- WHY
-- ---
-- staff_money_summary and staff_player_money_rows (migration
-- 20261007010000_staff_money_totals.sql) feed every money figure on the
-- dashboard, but add up only public.bets (Triple Chance) and
-- public.lucky_card_bets. Spin2Win bets were missing from every total.
--
-- WHAT CHANGES
-- ------------
-- Both functions are replaced (CREATE OR REPLACE: same name, same arguments,
-- same return type) with ONE extra UNION ALL branch reading
-- public.spin2win_bets (user_id, total_stake, total_payout, created_at -- the
-- same four columns the other two games give). staff_money_summary also lists
-- 'spin2win' as a third game, so its answer gains a "spin2win" part next to
-- "triple_chance" and "lucky_card" in each window; those two parts are
-- computed exactly as before.
--
-- PURELY ADDITIVE to the answer. No table, column, index, data or other
-- function is touched. Counting rules are unchanged (bets of a round still in
-- progress count their stake, payout 0 until settled -- the same as the other
-- games). CREATE OR REPLACE keeps the existing grants; they are restated below
-- anyway (service_role only, Issue #120). SAFETY and PERFORMANCE notes of
-- 20261007010000 still apply.
--
-- ROLLBACK: re-run the two function bodies of
-- 20261007010000_staff_money_totals.sql with CREATE OR REPLACE.
-- #############################################################################

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_money_summary(
  p_agent_id  UUID        DEFAULT NULL,
  p_day_start TIMESTAMPTZ DEFAULT NULL,
  p_from      TIMESTAMPTZ DEFAULT NULL,
  p_to        TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH scoped AS MATERIALIZED (
    SELECT x.game,
           x.total_stake,
           x.total_payout,
           (p_day_start IS NOT NULL AND x.created_at >= p_day_start)                AS is_today,
           ((p_from IS NULL OR x.created_at >= p_from)
             AND (p_to IS NULL OR x.created_at <= p_to))                            AS in_window
      FROM (
        SELECT 'triple_chance'::text AS game, b.user_id, b.total_stake, b.total_payout, b.created_at
          FROM public.bets b
        UNION ALL
        SELECT 'lucky_card'::text,            l.user_id, l.total_stake, l.total_payout, l.created_at
          FROM public.lucky_card_bets l
        UNION ALL
        SELECT 'spin2win'::text,              w.user_id, w.total_stake, w.total_payout, w.created_at
          FROM public.spin2win_bets w
      ) x
     WHERE p_agent_id IS NULL
        OR x.user_id IN (SELECT p.id FROM public.profiles p WHERE p.agent_id = p_agent_id)
  )
  SELECT jsonb_object_agg(per_scope.scope, per_scope.games)
    FROM (
      SELECT sc.scope,
             jsonb_object_agg(g.game, jsonb_build_object(
               'bets',   COALESCE(t.bets, 0),
               'stake',  COALESCE(t.stake, 0),
               'payout', COALESCE(t.payout, 0)
             )) AS games
        FROM (VALUES ('lifetime'), ('today'), ('window')) AS sc(scope)
        CROSS JOIN (VALUES ('triple_chance'), ('lucky_card'), ('spin2win')) AS g(game)
        LEFT JOIN LATERAL (
          SELECT count(*)::bigint                    AS bets,
                 COALESCE(sum(s.total_stake), 0)::bigint  AS stake,
                 COALESCE(sum(s.total_payout), 0)::bigint AS payout
            FROM scoped s
           WHERE s.game = g.game
             AND CASE sc.scope
                   WHEN 'lifetime' THEN true
                   WHEN 'today'    THEN s.is_today
                   ELSE                 s.in_window
                 END
        ) t ON true
       GROUP BY sc.scope
    ) per_scope;
$fn$;

CREATE OR REPLACE FUNCTION public.staff_player_money_rows(
  p_agent_id UUID,
  p_from     TIMESTAMPTZ DEFAULT NULL,
  p_to       TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  user_id        UUID,
  plays          BIGINT,
  stake          BIGINT,
  payout         BIGINT,
  last_played_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT x.user_id,
         count(*)::bigint,
         COALESCE(sum(x.total_stake), 0)::bigint,
         COALESCE(sum(x.total_payout), 0)::bigint,
         max(x.created_at)
    FROM (
      SELECT b.user_id, b.total_stake, b.total_payout, b.created_at FROM public.bets b
      UNION ALL
      SELECT l.user_id, l.total_stake, l.total_payout, l.created_at FROM public.lucky_card_bets l
      UNION ALL
      SELECT w.user_id, w.total_stake, w.total_payout, w.created_at FROM public.spin2win_bets w
    ) x
   WHERE x.user_id IN (SELECT p.id FROM public.profiles p WHERE p.agent_id = p_agent_id)
     AND (p_from IS NULL OR x.created_at >= p_from)
     AND (p_to   IS NULL OR x.created_at <= p_to)
   GROUP BY x.user_id;
$fn$;

-- Internal: service_role only (Issue #120).
REVOKE ALL ON FUNCTION public.staff_money_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_money_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.staff_player_money_rows(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_player_money_rows(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;

COMMENT ON FUNCTION public.staff_money_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Exact bet count, stake and payout for Triple Chance, Lucky Card and Spin2Win over three '
  'windows (lifetime, today from p_day_start, and p_from..p_to), for everyone or '
  'for one agent''s players. Counts bets of a round still in progress. Read only; '
  'internal, service_role only (the dashboard server). Issue #122; Spin2Win added 2026-10-25.';

COMMENT ON FUNCTION public.staff_player_money_rows(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'One row per player of an agent who played in the window: plays, stake, payout '
  '(all three games combined) and the last time they played. Read only; internal, '
  'service_role only (the dashboard server). Issue #122; Spin2Win added 2026-10-25.';

COMMIT;
