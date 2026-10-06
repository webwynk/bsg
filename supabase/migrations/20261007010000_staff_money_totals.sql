-- #############################################################################
-- STAFF MONEY TOTALS: exact bet / payout sums for BOTH games, added up inside
-- the database
-- Migration: 20261007010000_staff_money_totals.sql
-- Issue: #122 (MASTER_AUDIT_AND_REMEDIATION_PLAN.md); Lucky Card spec 17AY
-- #############################################################################
--
-- WHY
-- ---
-- Every money figure on the dashboard (the superadmin overview, an agent's
-- "today", the agent profit report) used to be added up in JavaScript from
-- rows downloaded through the REST layer. That layer returns at most 1,000
-- rows, even for `.range(0, 999999)`, so with 9,508 bets the superadmin
-- overview showed lifetime bet coins of 724,939 instead of 10,228,697 (Issue
-- #122). It also counted only Triple Chance. These two functions add the
-- figures up here, exactly, for Triple Chance AND Lucky Card, and hand back a
-- few numbers instead of thousands of rows.
--
-- PURELY ADDITIVE. Two new read-only functions; no table, column, index, data
-- or existing function is created, changed or dropped. They only READ
-- public.bets (Triple Chance), public.lucky_card_bets and public.profiles
-- (permission requested from the user 2026-10-07).
--
-- THE TWO FUNCTIONS
-- -----------------
-- staff_money_summary(p_agent_id, p_day_start, p_from, p_to) -> jsonb
--   {
--     "lifetime": { "triple_chance": {bets, stake, payout}, "lucky_card": {...} },
--     "today":    { ... },   -- bets created at or after p_day_start
--     "window":   { ... }    -- bets created between p_from and p_to
--   }
--   * p_agent_id NULL = every player; otherwise only the players of that agent
--     (profiles.agent_id = p_agent_id).
--   * p_day_start: the start of "today". The CALLER passes it, in India time
--     (the dashboard's existing day boundary), so this function does not guess
--     a time zone. NULL gives zeros for "today".
--   * p_from / p_to: both optional and inclusive; both NULL makes "window" the
--     same as "lifetime" (what the profit report did for its "lifetime" preset).
--   * Bets of a round still in progress ARE counted (their stake is in, their
--     payout is 0 until the round settles), exactly as the dashboard did for
--     Triple Chance before. The house result therefore reads slightly high for
--     up to about 100 seconds, until the round settles (user decision
--     2026-10-07).
--
-- staff_player_money_rows(p_agent_id, p_from, p_to) -> one row per player
--   (user_id, plays, stake, payout, last_played_at), both games combined, for
--   the players of p_agent_id who played in the window. Feeds the profit
--   report's per-player table (combined per player, user decision 2026-10-07).
--
-- SAFETY
-- ------
--   * LANGUAGE sql, STABLE, SECURITY DEFINER, search_path pinned to public.
--   * Executable by service_role ONLY (the dashboard's server-side admin
--     client). Revoked from PUBLIC, anon and authenticated explicitly: this
--     database's default privileges would otherwise grant EXECUTE to anon and
--     authenticated on every new function (Issue #120). CREATE OR REPLACE keeps
--     these grants; DROP + CREATE does not.
--   * The functions trust their caller, so they must never be exposed to a
--     client role; the dashboard calls them only after requireAuth().
--
-- PERFORMANCE
-- -----------
-- Both read every bet of the scope once (the "lifetime" figure needs them all):
-- milliseconds at the current 9,514 rows. When bets runs into the millions, an
-- index on bets (created_at) would help the network-wide "today" figure; that
-- is a change to a Triple Chance table and is left for the user to decide then
-- (noted in Issue #122).
-- #############################################################################

BEGIN;

CREATE FUNCTION public.staff_money_summary(
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
        CROSS JOIN (VALUES ('triple_chance'), ('lucky_card')) AS g(game)
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

CREATE FUNCTION public.staff_player_money_rows(
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
    ) x
   WHERE x.user_id IN (SELECT p.id FROM public.profiles p WHERE p.agent_id = p_agent_id)
     AND (p_from IS NULL OR x.created_at >= p_from)
     AND (p_to   IS NULL OR x.created_at <= p_to)
   GROUP BY x.user_id;
$fn$;

-- Internal: service_role only. See SAFETY above (Issue #120).
REVOKE ALL ON FUNCTION public.staff_money_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_money_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.staff_player_money_rows(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_player_money_rows(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;

COMMENT ON FUNCTION public.staff_money_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Exact bet count, stake and payout for Triple Chance and Lucky Card over three '
  'windows (lifetime, today from p_day_start, and p_from..p_to), for everyone or '
  'for one agent''s players. Counts bets of a round still in progress. Read only; '
  'internal, service_role only (the dashboard server). Issue #122.';

COMMENT ON FUNCTION public.staff_player_money_rows(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'One row per player of an agent who played in the window: plays, stake, payout '
  '(both games combined) and the last time they played. Read only; internal, '
  'service_role only (the dashboard server). Issue #122.';

COMMIT;
