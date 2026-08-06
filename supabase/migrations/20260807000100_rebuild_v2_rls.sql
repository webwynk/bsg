-- #############################################################################
-- BSG v2 — ROW LEVEL SECURITY
-- Migration: 20260807000100_rebuild_v2_rls.sql
-- #############################################################################
--
-- MODEL
--   Clients (anon + authenticated) get SELECT only, scoped to what they own.
--   There are deliberately NO INSERT / UPDATE / DELETE policies on any table:
--   with RLS enabled and no policy for a command, that command is denied. Every
--   write therefore has to go through a SECURITY DEFINER function that checks
--   auth.uid() itself. That is invariant 8 — a client cannot move coins by
--   talking to PostgREST directly, no matter what key it holds.
--
--   The service-role key bypasses RLS entirely. v1 leaned on that and treated
--   "called with the service key" as "is a superadmin", which is what made the
--   dashboard's unauthenticated coin minting possible (finding A-5/C-6). In v2
--   no function grants privilege on that basis; role always comes from
--   public.profiles keyed by auth.uid().
--
-- ROLE HELPERS
--   current_role_name() and current_agent_id() are SECURITY DEFINER + STABLE so
--   they can be used inside policies without recursing through RLS on profiles.
-- #############################################################################

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLE HELPERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_role_name()
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.current_is_active()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT COALESCE((SELECT is_active FROM public.profiles WHERE id = auth.uid()), false) $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENABLE RLS EVERYWHERE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_ledger     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.play_limits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log       ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles — own row; agents see their players; superadmin sees all
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR public.current_role_name() = 'superadmin'
    OR (public.current_role_name() = 'agent' AND agent_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- rounds — the outcome must NOT be readable while betting is open
-- ─────────────────────────────────────────────────────────────────────────────
-- v1 had `USING (true)` here, which combined with digits drawn 20s before the
-- betting cutoff meant the winning number was publicly readable with the anon
-- key while bets were still being accepted (finding D-1).
--
-- v2 closes it at two layers: digits are not drawn until after the cutoff
-- (game_config.draw_at_second), AND this policy refuses to expose a round row
-- at all until it has been drawn. The current round is served exclusively by
-- get_current_round(), which decides what is safe to reveal.
CREATE POLICY rounds_select_settled ON public.rounds
  FOR SELECT USING (
    phase = 'settled'
    OR public.current_role_name() = 'superadmin'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- bets — own bets; agents see their players'; superadmin sees all
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY bets_select ON public.bets
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.current_role_name() = 'superadmin'
    OR (
      public.current_role_name() = 'agent'
      AND user_id IN (SELECT id FROM public.profiles WHERE agent_id = auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- coin_ledger — own movements; agents see their players' and their own
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY coin_ledger_select ON public.coin_ledger
  FOR SELECT USING (
    user_id = auth.uid()
    OR counterparty_id = auth.uid()
    OR public.current_role_name() = 'superadmin'
    OR (
      public.current_role_name() = 'agent'
      AND user_id IN (SELECT id FROM public.profiles WHERE agent_id = auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- active_sessions — own row only
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY active_sessions_select ON public.active_sessions
  FOR SELECT USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- play_limits — readable by any signed-in user (the game needs the caps)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY play_limits_select ON public.play_limits
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- game_config — staff only. rtp_percentage is house-sensitive and must not be
-- readable by a player, who could otherwise infer the intended payout.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY game_config_select ON public.game_config
  FOR SELECT USING (public.current_role_name() IN ('agent','superadmin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_log — superadmin only
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT USING (public.current_role_name() = 'superadmin');

-- ─────────────────────────────────────────────────────────────────────────────
-- HARDENING: revoke direct DML from the client roles.
-- RLS already denies it (no policies), but revoking makes the intent explicit
-- and protects against a future policy being added carelessly.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

COMMIT;
