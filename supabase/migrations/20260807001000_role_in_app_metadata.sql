-- #############################################################################
-- BSG v2 — MOVE ROLE INTO app_metadata  (fixes S-2)
-- Migration: 20260807001000_role_in_app_metadata.sql
-- #############################################################################
--
-- PROBLEM
--   middleware.ts read the role from `user_metadata`:
--       const userRole = user?.user_metadata?.role   // "strictly from JWT"
--   In Supabase, user_metadata (raw_user_meta_data) is SELF-SERVICE WRITABLE:
--   any authenticated user can call
--       supabase.auth.updateUser({ data: { role: 'superadmin' } })
--   with their own token and change it. Only app_metadata (raw_app_meta_data)
--   requires the service role.
--
--   So the route guard was trusting a field the attacker controls.
--
-- FIX
--   Role authority order becomes:
--     1. public.profiles.role         — the record of truth (server-side only)
--     2. raw_app_meta_data->>'role'   — mirrored for the middleware, not
--                                       user-writable, and carried in the JWT
--                                       so the guard needs no database round
--                                       trip on every navigation
--   raw_user_meta_data is never consulted for authorization again.
--
--   The trigger keeps reading user_metadata for the *requested* role, but that
--   value is only a hint: it is still clamped to agent/player, and the
--   authoritative copy is written to app_metadata here.
-- #############################################################################

BEGIN;

-- Rewritten trigger: mirrors the final, clamped role into app_metadata so the
-- middleware can trust the JWT.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_username TEXT;
  v_role     TEXT;
  v_agent_id UUID;
BEGIN
  v_username := COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1));

  -- The requested role is a hint only, and is clamped: a superadmin can never
  -- be created through signup, only seeded deliberately.
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'player');
  IF v_role NOT IN ('agent','player') THEN
    v_role := 'player';
  END IF;

  BEGIN
    v_agent_id := NULLIF(NEW.raw_user_meta_data->>'agent_id','')::UUID;
  EXCEPTION WHEN others THEN
    v_agent_id := NULL;
  END;

  IF v_role = 'player' AND v_agent_id IS NULL THEN
    RAISE EXCEPTION 'A player must be created with agent_id in user metadata'
      USING errcode = 'P0101';
  END IF;
  IF v_role = 'agent' THEN
    v_agent_id := NULL;
  END IF;

  INSERT INTO public.profiles (id, username, email, full_name, role, agent_id, coin_balance)
  VALUES (
    NEW.id,
    v_username,
    lower(v_username) || '@bestsmartgame.com',
    NEW.raw_user_meta_data->>'full_name',
    v_role,
    v_agent_id,
    0
  );

  -- Mirror the clamped role into app_metadata (server-writable only).
  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('role', v_role)
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- Keep app_metadata.role in step if a role is ever changed in profiles
-- (e.g. the superadmin promotion during seeding).
CREATE OR REPLACE FUNCTION public.sync_role_to_app_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    UPDATE auth.users
       SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                               || jsonb_build_object('role', NEW.role)
     WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_role_changed ON public.profiles;
CREATE TRIGGER on_profile_role_changed
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_to_app_metadata();

-- Backfill every existing account (the seeded superadmin).
UPDATE auth.users u
   SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', p.role)
  FROM public.profiles p
 WHERE p.id = u.id;

COMMIT;
