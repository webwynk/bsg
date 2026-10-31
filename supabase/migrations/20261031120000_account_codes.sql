-- #############################################################################
-- ACCOUNT IDS - STEP 1: TABLES, ASSIGNMENT FUNCTION, TRIGGER
-- Migration: 20261031120000_account_codes.sql
-- Plan: account ID design (approved by Hasan 2026-10-31)
-- #############################################################################
--
-- Gives every player and agent a permanent, unique ID such as R01: the first
-- letter of the username, uppercase, plus a number. A username starting with a
-- digit uses X. Players and agents share one counter per letter, so an ID is
-- unique across both. Superadmins get none.
--
-- ADDITIVE. Creates two tables and two functions, and attaches one new trigger
-- to public.profiles. No existing function, policy, column or row is changed.
-- The trigger runs only when a profile row is created, never on a balance
-- update, so it adds nothing to gameplay.
--
-- THE RULES
--   * An ID never changes: nothing updates account_codes, and a later username
--     change leaves it as it was.
--   * A number is never reused: the counter only goes up, and account_codes
--     deliberately has no foreign key to profiles, so the row outlives a
--     deleted account for any printed ticket that refers to it.
--   * R09, R10, R99, R100: at least two digits, then as many as needed.
--
-- A FAILURE NEVER BLOCKS AN ACCOUNT. The trigger runs inside the transaction
-- that creates the account, so an error here would cancel it. It catches any
-- error, writes one audit_log 'system' row, and lets the account be created.
-- Re-running 20261031130000_account_codes_backfill.sql repairs such an account.
--
-- CONCURRENCY. The counter is a single atomic INSERT .. ON CONFLICT .. UPDATE.
-- Its row lock lasts until the creating transaction ends, so two accounts with
-- the same letter wait for each other and can never get the same number.
--
-- APPLYING. CREATE TRIGGER briefly locks public.profiles against writes, and
-- every bet writes that table. lock_timeout makes the file fail cleanly rather
-- than hold bets up. Apply between rounds; a timeout changes nothing and can be
-- retried.
--
-- SECURITY: identical to the game tables. RLS on, SELECT only, no client writes,
-- and the functions are not callable by any client.
-- #############################################################################

BEGIN;

SET LOCAL lock_timeout = '3s';

-- =============================================================================
-- account_code_counters
-- =============================================================================
-- The last number given out for each letter. Staff and clients have no need to
-- read this, so it has no policy at all.
CREATE TABLE public.account_code_counters (
  letter      CHAR(1) PRIMARY KEY CHECK (letter ~ '^[A-Z]$'),
  last_number INTEGER NOT NULL CHECK (last_number >= 1)
);

-- =============================================================================
-- account_codes
-- =============================================================================
CREATE TABLE public.account_codes (
  user_id     UUID        PRIMARY KEY,
  code        TEXT        NOT NULL UNIQUE CHECK (code ~ '^[A-Z][0-9]{2,}$'),
  letter      CHAR(1)     NOT NULL CHECK (letter ~ '^[A-Z]$'),
  number      INTEGER     NOT NULL CHECK (number >= 1),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT account_codes_one_number_per_letter UNIQUE (letter, number)
);

-- =============================================================================
-- assign_account_code
-- =============================================================================
-- Gives p_user_id its ID, or returns the one it already has, so it is safe to
-- call twice. Internal: called by the trigger and the backfill only.
CREATE FUNCTION public.assign_account_code(p_user_id UUID, p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_code   TEXT;
  v_first  TEXT := upper(left(p_username, 1));
  v_letter CHAR(1);
  v_number INTEGER;
BEGIN
  SELECT code INTO v_code FROM public.account_codes WHERE user_id = p_user_id;
  IF FOUND THEN
    RETURN v_code;
  END IF;

  -- A username starting with a digit shares the X counter.
  v_letter := CASE WHEN v_first ~ '^[A-Z]$' THEN v_first ELSE 'X' END;

  INSERT INTO public.account_code_counters (letter, last_number)
  VALUES (v_letter, 1)
  ON CONFLICT (letter) DO UPDATE
    SET last_number = public.account_code_counters.last_number + 1
  RETURNING last_number INTO v_number;

  v_code := v_letter || lpad(v_number::TEXT, GREATEST(2, length(v_number::TEXT)), '0');

  INSERT INTO public.account_codes (user_id, code, letter, number)
  VALUES (p_user_id, v_code, v_letter, v_number);

  RETURN v_code;
END;
$fn$;

-- =============================================================================
-- account_code_on_profile_insert
-- =============================================================================
-- Trigger function. Catches every error so an ID problem can never stop an
-- account being created; see the header.
CREATE FUNCTION public.account_code_on_profile_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  BEGIN
    PERFORM public.assign_account_code(NEW.id, NEW.username);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_log (actor_id, kind, detail)
    VALUES (NULL, 'system',
      format('account_code_on_profile_insert: account %s got no ID: %s', NEW.id, SQLERRM));
  END;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER on_profile_created_assign_code
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  WHEN (NEW.role IN ('player', 'agent'))
  EXECUTE FUNCTION public.account_code_on_profile_insert();

-- =============================================================================
-- SECURITY
-- =============================================================================
ALTER TABLE public.account_code_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_codes         ENABLE ROW LEVEL SECURITY;

-- The same people who can see the profile can see its ID.
CREATE POLICY account_codes_select ON public.account_codes
  FOR SELECT USING (
    (
      user_id = auth.uid()
      OR current_role_name() = 'superadmin'
      OR (current_role_name() = 'agent' AND user_id IN (
            SELECT p.id FROM public.profiles p WHERE p.agent_id = auth.uid()
          ))
    ) AND current_is_active()
  );

GRANT SELECT ON public.account_codes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_codes, public.account_code_counters TO service_role;

-- This database's default privileges grant anon/authenticated full DML,
-- including TRUNCATE (which RLS does not block), on every new public table.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.account_codes FROM anon, authenticated;
REVOKE ALL ON public.account_code_counters FROM anon, authenticated;

-- Default privileges also grant EXECUTE on every new function (Issue #120).
REVOKE ALL ON FUNCTION public.assign_account_code(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_code_on_profile_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_account_code(UUID, TEXT) TO service_role;

COMMENT ON TABLE public.account_codes IS
  'The permanent ID of each player and agent, such as R01. Never changed or '
  'reused. No foreign key to profiles, so it outlives a deleted account.';
COMMENT ON TABLE public.account_code_counters IS
  'The last number given out per letter, shared by players and agents. Only '
  'ever goes up, which is what stops a number being reused.';
COMMENT ON FUNCTION public.assign_account_code(UUID, TEXT) IS
  'Gives an account its ID, or returns the one it has. Internal: called by the '
  'on_profile_created_assign_code trigger and the backfill.';
COMMENT ON FUNCTION public.account_code_on_profile_insert() IS
  'Trigger: assigns the ID of a new player or agent. Any failure goes to '
  'audit_log and never stops the account being created.';

COMMIT;
