-- #############################################################################
-- STAFF MONEY TOTALS: add Lucky 16 Card to the two staff money functions
-- Migration: 20261030150000_staff_money_totals_add_lucky16.sql
-- Lucky 16 Card dashboard step 18
-- #############################################################################
--
-- WHY
-- ---
-- staff_money_summary and staff_player_money_rows feed every money figure on
-- the dashboard, but add up only public.bets (Triple Chance),
-- public.lucky_card_bets and public.spin2win_bets. Lucky 16 Card bets are
-- missing from every total.
--
-- WHAT CHANGES
-- ------------
-- Both functions are replaced (CREATE OR REPLACE: same name, same arguments,
-- same return type) with ONE extra UNION ALL branch reading
-- public.lucky16_bets (user_id, total_stake, total_payout, created_at -- the
-- same four columns the other games give). staff_money_summary also lists
-- 'lucky16' as a fourth game, so its answer gains a "lucky16" part next to the
-- other three in each window; those three parts are computed exactly as before.
--
-- PURELY ADDITIVE to the answer. No table, column, index, data or other
-- function is touched. Counting rules are unchanged (bets of a round still in
-- progress count their stake, payout 0 until settled -- the same as the other
-- games). CREATE OR REPLACE keeps the existing grants; they are restated below
-- anyway (service_role only, Issue #120). SAFETY and PERFORMANCE notes of
-- 20261007010000 still apply.
--
-- ROLLBACK: re-run the two function bodies of
-- 20261025190000_staff_money_totals_add_spin2win.sql with CREATE OR REPLACE.
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
        UNION ALL
        SELECT 'lucky16'::text,               c.user_id, c.total_stake, c.total_payout, c.created_at
          FROM public.lucky16_bets c
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
        CROSS JOIN (VALUES ('triple_chance'), ('lucky_card'), ('spin2win'), ('lucky16')) AS g(game)
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
      UNION ALL
      SELECT c.user_id, c.total_stake, c.total_payout, c.created_at FROM public.lucky16_bets c
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
  'Exact bet count, stake and payout for Triple Chance, Lucky Card, Spin2Win and Lucky 16 Card over three '
  'windows (lifetime, today from p_day_start, and p_from..p_to), for everyone or '
  'for one agent''s players. Counts bets of a round still in progress. Read only; '
  'internal, service_role only (the dashboard server). Issue #122; Spin2Win added 2026-10-25, Lucky 16 Card added 2026-10-30.';

COMMENT ON FUNCTION public.staff_player_money_rows(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'One row per player of an agent who played in the window: plays, stake, payout '
  '(all four games combined) and the last time they played. Read only; internal, '
  'service_role only (the dashboard server). Issue #122; Spin2Win added 2026-10-25, Lucky 16 Card added 2026-10-30.';

COMMIT;
