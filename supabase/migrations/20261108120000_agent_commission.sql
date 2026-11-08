-- Agent commission % (2026-11-08, Hasan's request; plan in docs/AGENT_COMMISSION_PLAN.md).
--
-- The superadmin sets a commission % per agent. For any period the dashboard
-- shows that agent's players' Bets, Wins, P&L (= Bets - Wins), the commission
-- (= Bets x the agent's %) and the Final figure (worked out in the dashboard,
-- src/lib/agent-commission.ts). The commission is a REPORT FIGURE ONLY: no
-- coins move, nothing here touches balances, bets or the coin ledger.
--
-- 1. agent_commission_rates: the HISTORY of each agent's %. One row per IST day
--    on which the % was set; the % valid on a day is the newest row whose
--    effective_from is on or before that day (no row = 0%). So when the % is
--    changed, the new % counts from that IST day on and earlier days keep the
--    old %, and a past period always reproduces the same figures. A second
--    change on the same IST day replaces that day's row (the audit log keeps
--    both changes).
-- 2. set_agent_commission(actor, agent, pct): the ONLY way to write a rate.
--    Superadmin only, 0-100 with at most 2 decimals, and it writes the
--    audit_log row in the SAME transaction (a change can't happen unlogged).
-- 3. staff_agent_commission_report(agent, from, to): read-only report for a
--    window (inclusive; NULL = no limit), grouped per IST day with that day's %,
--    plus per-game totals and the rates that applied. Commission is returned
--    EXACT (numeric, not rounded) so per-day and per-game figures add up to the
--    total exactly; the dashboard rounds only for display.
-- 4. staff_agent_commission_history(agent, limit): the latest changes, with who
--    set them, for the Edit % dialog.
--
-- Everything is server-only: EXECUTE / SELECT for service_role (the dashboard,
-- after requireAuth), nothing for anon / authenticated. IST day = UTC + 05:30
-- (India has no daylight saving, so the fixed offset is exact), as in
-- staff_player_daily_money. Rollback: scripts/agent_commission_rollback.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';

-- 1. Rate history ------------------------------------------------------------
CREATE TABLE public.agent_commission_rates (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id       uuid          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_from date          NOT NULL,                 -- IST day the % starts counting
  rate_pct       numeric(5,2)  NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 100),
  set_by         uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT agent_commission_rates_one_per_day UNIQUE (agent_id, effective_from)
);

COMMENT ON TABLE public.agent_commission_rates IS
  'History of each agent''s commission %. The % on a day = newest row with effective_from <= that IST day; none = 0%. Written only by set_agent_commission (superadmin, audited). Report figure only, no coins move.';

-- Clients never touch it: RLS on with no policies, and no table rights.
ALTER TABLE public.agent_commission_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_commission_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_commission_rates TO service_role;

-- 2. Set an agent's % (superadmin only, audited) ------------------------------
CREATE FUNCTION public.set_agent_commission(
  p_actor_id uuid,
  p_agent_id uuid,
  p_rate_pct numeric
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor   public.profiles%ROWTYPE;
  v_agent   public.profiles%ROWTYPE;
  v_today   date := ((now() AT TIME ZONE 'UTC') + INTERVAL '5 hours 30 minutes')::date;
  v_old     numeric(5,2);
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role <> 'superadmin' OR NOT v_actor.is_active THEN
    RAISE EXCEPTION 'Only the superadmin can set an agent''s commission.' USING ERRCODE = '42501';
  END IF;

  -- Lock the agent's profile row so two changes to the same agent run one after the other.
  SELECT * INTO v_agent FROM public.profiles WHERE id = p_agent_id FOR UPDATE;
  IF NOT FOUND OR v_agent.role <> 'agent' THEN
    RAISE EXCEPTION 'Agent not found.' USING ERRCODE = 'P0002';
  END IF;

  IF p_rate_pct IS NULL OR p_rate_pct < 0 OR p_rate_pct > 100 THEN
    RAISE EXCEPTION 'Commission must be between 0 and 100.' USING ERRCODE = '22023';
  END IF;
  IF p_rate_pct <> round(p_rate_pct, 2) THEN
    RAISE EXCEPTION 'Commission can have at most 2 decimals.' USING ERRCODE = '22023';
  END IF;

  SELECT r.rate_pct INTO v_old
    FROM public.agent_commission_rates r
   WHERE r.agent_id = p_agent_id AND r.effective_from <= v_today
   ORDER BY r.effective_from DESC
   LIMIT 1;
  v_old := COALESCE(v_old, 0);

  IF v_old = p_rate_pct THEN
    RETURN jsonb_build_object('changed', false, 'old_pct', v_old, 'new_pct', p_rate_pct, 'effective_from', v_today);
  END IF;

  INSERT INTO public.agent_commission_rates (agent_id, effective_from, rate_pct, set_by)
  VALUES (p_agent_id, v_today, p_rate_pct, p_actor_id)
  ON CONFLICT (agent_id, effective_from)
  DO UPDATE SET rate_pct = EXCLUDED.rate_pct, set_by = EXCLUDED.set_by, updated_at = now();

  INSERT INTO public.audit_log (actor_id, kind, detail)
  VALUES (p_actor_id, 'account', format('Commission for @%s: %s%% -> %s%% (from %s IST)',
          v_agent.username, to_char(v_old, 'FM990.00'), to_char(p_rate_pct, 'FM990.00'), to_char(v_today, 'DD Mon YYYY')));

  RETURN jsonb_build_object('changed', true, 'old_pct', v_old, 'new_pct', p_rate_pct, 'effective_from', v_today);
END;
$function$;

-- 3. Commission report for a window -------------------------------------------
CREATE FUNCTION public.staff_agent_commission_report(
  p_agent_id uuid,
  p_from     timestamptz DEFAULT NULL,
  p_to       timestamptz DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH bets AS MATERIALIZED (
    SELECT x.game,
           ((x.created_at AT TIME ZONE 'UTC') + INTERVAL '5 hours 30 minutes')::date AS day,
           x.total_stake, x.total_payout
      FROM (
        SELECT 'triple_chance'::text AS game, b.user_id, b.total_stake, b.total_payout, b.created_at FROM public.bets b
        UNION ALL
        SELECT 'lucky_card'::text, l.user_id, l.total_stake, l.total_payout, l.created_at FROM public.lucky_card_bets l
        UNION ALL
        SELECT 'spin2win'::text,   w.user_id, w.total_stake, w.total_payout, w.created_at FROM public.spin2win_bets w
        UNION ALL
        SELECT 'lucky16'::text,    c.user_id, c.total_stake, c.total_payout, c.created_at FROM public.lucky16_bets c
      ) x
     WHERE x.user_id IN (SELECT p.id FROM public.profiles p WHERE p.agent_id = p_agent_id)
       AND (p_from IS NULL OR x.created_at >= p_from)
       AND (p_to   IS NULL OR x.created_at <= p_to)
  ),
  per_game_day AS (
    SELECT b.game, b.day, count(*)::bigint AS plays,
           COALESCE(sum(b.total_stake), 0)::bigint AS stake,
           COALESCE(sum(b.total_payout), 0)::bigint AS payout,
           COALESCE((SELECT r.rate_pct FROM public.agent_commission_rates r
                      WHERE r.agent_id = p_agent_id AND r.effective_from <= b.day
                      ORDER BY r.effective_from DESC LIMIT 1), 0)::numeric AS rate_pct
      FROM bets b
     GROUP BY b.game, b.day
  ),
  per_day AS (
    SELECT d.day, sum(d.plays)::bigint AS plays, sum(d.stake)::bigint AS stake, sum(d.payout)::bigint AS payout,
           max(d.rate_pct) AS rate_pct,                    -- the same for every game on a day
           sum(d.stake * d.rate_pct / 100) AS commission
      FROM per_game_day d
     GROUP BY d.day
  ),
  games AS (
    SELECT g.game,
           COALESCE(sum(d.plays), 0)::bigint AS plays,
           COALESCE(sum(d.stake), 0)::bigint AS stake,
           COALESCE(sum(d.payout), 0)::bigint AS payout,
           COALESCE(sum(d.stake * d.rate_pct / 100), 0) AS commission
      FROM (VALUES ('triple_chance'), ('lucky_card'), ('spin2win'), ('lucky16')) g(game)
      LEFT JOIN per_game_day d ON d.game = g.game
     GROUP BY g.game
  ),
  win AS (
    SELECT CASE WHEN p_from IS NULL THEN NULL ELSE ((p_from AT TIME ZONE 'UTC') + INTERVAL '5 hours 30 minutes')::date END AS first_day,
           CASE WHEN p_to   IS NULL THEN NULL ELSE ((p_to   AT TIME ZONE 'UTC') + INTERVAL '5 hours 30 minutes')::date END AS last_day
  ),
  rates AS (
    -- The % in force at the start of the window plus every change inside it.
    SELECT r.effective_from, r.rate_pct
      FROM public.agent_commission_rates r, win w
     WHERE r.agent_id = p_agent_id
       AND (w.last_day IS NULL OR r.effective_from <= w.last_day)
       AND (w.first_day IS NULL OR r.effective_from > w.first_day
            OR r.effective_from = (SELECT max(r2.effective_from) FROM public.agent_commission_rates r2
                                    WHERE r2.agent_id = p_agent_id AND r2.effective_from <= w.first_day))
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
                 'plays', COALESCE(sum(plays), 0), 'stake', COALESCE(sum(stake), 0),
                 'payout', COALESCE(sum(payout), 0), 'commission', COALESCE(sum(commission), 0))
                 FROM per_day),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'day', to_char(day, 'YYYY-MM-DD'), 'plays', plays, 'stake', stake, 'payout', payout,
                 'rate_pct', rate_pct, 'commission', commission) ORDER BY day DESC) FROM per_day), '[]'::jsonb),
    'games', (SELECT jsonb_object_agg(game, jsonb_build_object(
                 'plays', plays, 'stake', stake, 'payout', payout, 'commission', commission)) FROM games),
    'rates', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'effective_from', to_char(effective_from, 'YYYY-MM-DD'), 'rate_pct', rate_pct)
                 ORDER BY effective_from) FROM rates), '[]'::jsonb),
    'current_rate_pct', COALESCE((SELECT r.rate_pct FROM public.agent_commission_rates r
                 WHERE r.agent_id = p_agent_id
                   AND r.effective_from <= ((now() AT TIME ZONE 'UTC') + INTERVAL '5 hours 30 minutes')::date
                 ORDER BY r.effective_from DESC LIMIT 1), 0)
  );
$function$;

-- 4. Latest changes, for the Edit % dialog ------------------------------------
CREATE FUNCTION public.staff_agent_commission_history(
  p_agent_id uuid,
  p_limit    integer DEFAULT 5
)
 RETURNS TABLE(effective_from date, rate_pct numeric, set_by_username text, updated_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.effective_from, r.rate_pct, p.username, r.updated_at
    FROM public.agent_commission_rates r
    LEFT JOIN public.profiles p ON p.id = r.set_by
   WHERE r.agent_id = p_agent_id
   ORDER BY r.effective_from DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.set_agent_commission(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_agent_commission_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_agent_commission_history(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_agent_commission(uuid, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_agent_commission_report(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_agent_commission_history(uuid, integer) TO service_role;

COMMIT;
