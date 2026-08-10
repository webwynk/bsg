-- Housekeeping #41 (MASTER_AUDIT_AND_REMEDIATION_PLAN.md): current_is_active()
-- existed, correct, but nothing ever called it -- confirmed live via a full
-- database cross-check (no app code, no RLS policy, no other function, no
-- trigger referenced it). Its sibling, current_role_name(), is already used
-- in 7 SELECT policies to answer "who is asking" -- but none of them also
-- ask "and are they currently allowed to be asking at all." A blocked
-- account's role never changes (blocking only flips is_active, not role),
-- so an agent who gets blocked is still, role-wise, an agent -- these rules
-- would keep saying yes to them narrowly for a direct database read, even
-- though every real path either app uses (requireAuth's explicit check,
-- the Auth-layer ban, place_bet/session_heartbeat's own is_active checks)
-- already correctly blocks them everywhere else.
--
-- Fix: AND current_is_active() onto each of the 7 policies that already
-- check current_role_name(). The two policies that never used
-- current_role_name() (play_limits_select: any authenticated user, no
-- per-role logic; active_sessions_select: always just your own row) are
-- deliberately left untouched -- neither was ever part of this pattern.
--
-- Each existing condition is wrapped in parentheses before ANDing the new
-- check on -- AND binds tighter than OR in SQL, so appending it unparenthesized
-- to an "A OR B OR C" condition would only have protected the last branch.

BEGIN;

ALTER POLICY audit_log_select ON public.audit_log
  USING (current_role_name() = 'superadmin' AND current_is_active());

ALTER POLICY bets_select ON public.bets
  USING (
    (
      (user_id = auth.uid())
      OR (current_role_name() = 'superadmin')
      OR (current_role_name() = 'agent' AND user_id IN (
            SELECT profiles.id FROM public.profiles WHERE profiles.agent_id = auth.uid()
          ))
    )
    AND current_is_active()
  );

ALTER POLICY coin_ledger_select ON public.coin_ledger
  USING (
    (
      (user_id = auth.uid())
      OR (counterparty_id = auth.uid())
      OR (current_role_name() = 'superadmin')
      OR (current_role_name() = 'agent' AND user_id IN (
            SELECT profiles.id FROM public.profiles WHERE profiles.agent_id = auth.uid()
          ))
    )
    AND current_is_active()
  );

ALTER POLICY game_config_select ON public.game_config
  USING (current_role_name() = ANY (ARRAY['agent'::text, 'superadmin'::text]) AND current_is_active());

ALTER POLICY notifications_select ON public.notifications
  USING (
    ((agent_id = auth.uid()) OR (current_role_name() = 'superadmin'))
    AND current_is_active()
  );

ALTER POLICY profiles_select ON public.profiles
  USING (
    (
      (id = auth.uid())
      OR (current_role_name() = 'superadmin')
      OR (current_role_name() = 'agent' AND agent_id = auth.uid())
    )
    AND current_is_active()
  );

ALTER POLICY rounds_select_settled ON public.rounds
  USING (
    ((phase = 'settled') OR (current_role_name() = 'superadmin'))
    AND current_is_active()
  );

COMMIT;
