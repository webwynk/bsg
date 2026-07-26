-- Migration: 20260726000000_single_session_enforcement.sql
-- Description: Adds active_sessions table and RPCs for single active session enforcement (Option A).

-- 1. Create public.active_sessions table to track user session timestamps
CREATE TABLE IF NOT EXISTS public.active_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- 2. check_and_update_login_session(p_user_id) RPC
-- Rejects login if user was active within last 60 seconds.
CREATE OR REPLACE FUNCTION public.check_and_update_login_session(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_seen timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT last_seen_at INTO v_last_seen
  FROM public.active_sessions
  WHERE user_id = p_user_id;

  -- Check if user is currently active (within last 60s)
  IF v_last_seen IS NOT NULL AND (v_now - v_last_seen) < interval '60 seconds' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Account is already logged in on another device'
    );
  END IF;

  -- User is not active — update last_seen_at to now() and allow login
  INSERT INTO public.active_sessions (user_id, last_seen_at)
  VALUES (p_user_id, v_now)
  ON CONFLICT (user_id)
  DO UPDATE SET last_seen_at = v_now;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- 3. update_user_heartbeat(p_user_id) RPC
-- Called every 25s by active client to keep session alive.
CREATE OR REPLACE FUNCTION public.update_user_heartbeat(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.active_sessions (user_id, last_seen_at)
  VALUES (p_user_id, now())
  ON CONFLICT (user_id)
  DO UPDATE SET last_seen_at = now();
END;
$$;

-- 4. clear_user_session(p_user_id) RPC
-- Called on logout to clear session immediately.
CREATE OR REPLACE FUNCTION public.clear_user_session(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.active_sessions
  WHERE user_id = p_user_id;
END;
$$;
