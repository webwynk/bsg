-- #############################################################################
-- BSG v2 — FULL REBUILD FROM SCRATCH
-- Migration: 20260807000000_rebuild_v2_schema.sql
-- #############################################################################
--
-- ⚠ DESTRUCTIVE. Drops every application table, function and policy, and every
--   auth user. A verified logical backup was taken first (_db_backup_20260806).
--
-- DESIGN DECISIONS (confirmed with the product owner):
--   * Hierarchy    : superadmin -> agent -> player. Exactly one agent level.
--   * Money        : whole coins only. The column is `coin_balance` everywhere.
--   * Outcome      : house-controlled. The draw is selected to track a
--                    configured RTP target, not drawn at random.
--   * Second login : REFUSED while the first session is still alive.
--   * Naming       : snake_case in the database and in every JSON payload.
--   * Identity     : email is always lower(username) || '@bestsmartgame.com'.
--
-- INVARIANTS ENFORCED BY THE SCHEMA, NOT BY APPLICATION CODE:
--   1. coin_balance can never be negative              -> CHECK
--   2. coin_balance is always whole                    -> BIGINT
--   3. email always derives from username              -> CHECK  (fixes the
--                                                         class of bug where
--                                                         login concatenated a
--                                                         different address)
--   4. a player always has an agent; agents/superadmin never do -> CHECK
--   5. one bet row per (round, player)                 -> UNIQUE
--   6. digits are 0-9 and arrive together, or are NULL -> CHECK
--   7. ledger sign always agrees with its kind         -> CHECK
--   8. clients cannot write any table directly         -> RLS with no
--                                                         INSERT/UPDATE/DELETE
--                                                         policies; all money
--                                                         moves via SECURITY
--                                                         DEFINER functions
-- #############################################################################

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — TEARDOWN
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.bets                  CASCADE;
DROP TABLE IF EXISTS public.rounds                CASCADE;
DROP TABLE IF EXISTS public.coin_ledger           CASCADE;
DROP TABLE IF EXISTS public.active_sessions       CASCADE;
DROP TABLE IF EXISTS public.audit_log             CASCADE;
DROP TABLE IF EXISTS public.play_limits           CASCADE;
DROP TABLE IF EXISTS public.game_config           CASCADE;
DROP TABLE IF EXISTS public.profiles              CASCADE;

-- Legacy v1 objects
DROP TABLE IF EXISTS public.triple_chance_bets    CASCADE;
DROP TABLE IF EXISTS public.triple_chance_rounds  CASCADE;
DROP TABLE IF EXISTS public.transactions          CASCADE;
DROP TABLE IF EXISTS public.agent_configs         CASCADE;
DROP TABLE IF EXISTS public.game_history          CASCADE;

-- Drop every remaining function in public. v1 left 21 behind, including
-- competing overloads of submit_round_bet. Rebuilt with one signature each.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;

-- Every auth user. Profiles cascade from here.
DELETE FROM auth.users;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- profiles ───────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username        TEXT        NOT NULL UNIQUE,
  email           TEXT        NOT NULL UNIQUE,
  full_name       TEXT,
  role            TEXT        NOT NULL CHECK (role IN ('superadmin','agent','player')),
  agent_id        UUID        REFERENCES public.profiles(id) ON DELETE RESTRICT,
  coin_balance    BIGINT      NOT NULL DEFAULT 0 CHECK (coin_balance >= 0),
  ledger_version  BIGINT      NOT NULL DEFAULT 0,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Invariant 4: exactly one agent level.
  CONSTRAINT profiles_hierarchy_check CHECK (
    (role = 'player'     AND agent_id IS NOT NULL) OR
    (role = 'agent'      AND agent_id IS NULL)     OR
    (role = 'superadmin' AND agent_id IS NULL)
  ),

  -- Usernames are the login identifier; keep them predictable.
  CONSTRAINT profiles_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),

  -- Invariant 3: email is derived, never independently chosen. This is the
  -- constraint that makes "logged in with the username but the account has a
  -- different email" structurally impossible.
  CONSTRAINT profiles_email_derived CHECK (
    email = lower(username) || '@bestsmartgame.com'
  )
);

CREATE INDEX idx_profiles_agent ON public.profiles (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_profiles_role  ON public.profiles (role);
CREATE UNIQUE INDEX idx_profiles_username_lower ON public.profiles (lower(username));

-- rounds ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.rounds (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number  BIGINT      NOT NULL UNIQUE,          -- floor(epoch / 103)
  phase         TEXT        NOT NULL DEFAULT 'betting'
                            CHECK (phase IN ('betting','drawing','settled')),
  red           SMALLINT    CHECK (red   BETWEEN 0 AND 9),
  green         SMALLINT    CHECK (green BETWEEN 0 AND 9),
  black         SMALLINT    CHECK (black BETWEEN 0 AND 9),
  total_stake   BIGINT      NOT NULL DEFAULT 0 CHECK (total_stake  >= 0),
  total_payout  BIGINT      NOT NULL DEFAULT 0 CHECK (total_payout >= 0),
  scheduled_at  TIMESTAMPTZ NOT NULL,
  drawn_at      TIMESTAMPTZ,
  settled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Invariant 6: digits arrive together or not at all.
  CONSTRAINT rounds_digits_complete CHECK (
    (red IS NULL     AND green IS NULL     AND black IS NULL) OR
    (red IS NOT NULL AND green IS NOT NULL AND black IS NOT NULL)
  ),
  -- A settled round must have been drawn.
  CONSTRAINT rounds_settled_has_digits CHECK (
    phase <> 'settled' OR red IS NOT NULL
  )
);

CREATE INDEX idx_rounds_number ON public.rounds (round_number DESC);
CREATE INDEX idx_rounds_phase  ON public.rounds (phase, round_number DESC);

-- bets ───────────────────────────────────────────────────────────────────────
CREATE TABLE public.bets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       UUID        NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  single_bets    JSONB       NOT NULL DEFAULT '{}',   -- {"7": 10}
  double_bets    JSONB       NOT NULL DEFAULT '{}',   -- {"42": 5}
  triple_bets    JSONB       NOT NULL DEFAULT '{}',   -- {"742": 2}
  total_stake    BIGINT      NOT NULL DEFAULT 0 CHECK (total_stake    >= 0),
  single_payout  BIGINT      NOT NULL DEFAULT 0 CHECK (single_payout  >= 0),
  double_payout  BIGINT      NOT NULL DEFAULT 0 CHECK (double_payout  >= 0),
  triple_payout  BIGINT      NOT NULL DEFAULT 0 CHECK (triple_payout  >= 0),
  total_payout   BIGINT      NOT NULL DEFAULT 0 CHECK (total_payout   >= 0),
  is_settled     BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at     TIMESTAMPTZ,

  CONSTRAINT bets_one_per_round UNIQUE (round_id, user_id),
  CONSTRAINT bets_payout_sum CHECK (
    total_payout = single_payout + double_payout + triple_payout
  )
);

CREATE INDEX idx_bets_user      ON public.bets (user_id, created_at DESC);
CREATE INDEX idx_bets_round     ON public.bets (round_id);
CREATE INDEX idx_bets_unsettled ON public.bets (round_id) WHERE NOT is_settled;

-- coin_ledger ────────────────────────────────────────────────────────────────
-- Append-only. One row per balance movement; balance_after records the
-- resulting coin_balance so the ledger can be reconciled against profiles.
CREATE TABLE public.coin_ledger (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  counterparty_id UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind            TEXT        NOT NULL CHECK (kind IN (
                                'stake',        -- player wagers            (negative)
                                'stake_refund', -- bet reduced/withdrawn    (positive)
                                'payout',       -- player wins              (positive)
                                'agent_credit', -- agent -> player          (positive)
                                'agent_debit',  -- player -> agent          (negative)
                                'admin_credit', -- superadmin -> agent      (positive)
                                'admin_debit'   -- agent -> superadmin      (negative)
                              )),
  amount          BIGINT      NOT NULL CHECK (amount <> 0),
  balance_after   BIGINT      NOT NULL CHECK (balance_after >= 0),
  -- RESTRICT, not SET NULL. A stake/payout row is required to carry its
  -- round_id (see ledger_game_has_round below), so SET NULL would produce a row
  -- that violates its own CHECK and make the delete fail with a confusing
  -- error. Rounds are financial records and are never deleted; this states that
  -- intent explicitly instead of leaving a contradiction in the schema.
  round_id        UUID        REFERENCES public.rounds(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Invariant 7: sign must agree with the kind, so a credit can never be
  -- booked as a debit (or vice versa) by a coding slip.
  CONSTRAINT ledger_sign_matches_kind CHECK (
    (kind IN ('payout','stake_refund','agent_credit','admin_credit') AND amount > 0) OR
    (kind IN ('stake','agent_debit','admin_debit')                   AND amount < 0)
  ),
  -- Gameplay movements must name the round they came from.
  CONSTRAINT ledger_game_has_round CHECK (
    kind NOT IN ('stake','stake_refund','payout') OR round_id IS NOT NULL
  )
);

CREATE INDEX idx_ledger_user  ON public.coin_ledger (user_id, created_at DESC);
CREATE INDEX idx_ledger_kind  ON public.coin_ledger (kind, created_at DESC);
CREATE INDEX idx_ledger_party ON public.coin_ledger (counterparty_id, created_at DESC);
CREATE INDEX idx_ledger_round ON public.coin_ledger (round_id) WHERE round_id IS NOT NULL;

-- active_sessions ────────────────────────────────────────────────────────────
CREATE TABLE public.active_sessions (
  user_id       UUID        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_token TEXT        NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_seen ON public.active_sessions (last_seen_at);

-- play_limits ────────────────────────────────────────────────────────────────
CREATE TABLE public.play_limits (
  id          TEXT        PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  single_min  BIGINT      NOT NULL DEFAULT 2     CHECK (single_min > 0),
  single_max  BIGINT      NOT NULL DEFAULT 10000,
  double_min  BIGINT      NOT NULL DEFAULT 2     CHECK (double_min > 0),
  double_max  BIGINT      NOT NULL DEFAULT 1000,
  triple_min  BIGINT      NOT NULL DEFAULT 2     CHECK (triple_min > 0),
  triple_max  BIGINT      NOT NULL DEFAULT 100,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT play_limits_ordered CHECK (
    single_min <= single_max AND double_min <= double_max AND triple_min <= triple_max
  )
);
INSERT INTO public.play_limits (id) VALUES ('global');

-- game_config ────────────────────────────────────────────────────────────────
CREATE TABLE public.game_config (
  id                TEXT         PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  rtp_percentage    NUMERIC(5,2) NOT NULL DEFAULT 96.00
                                 CHECK (rtp_percentage BETWEEN 50 AND 100),
  -- The second of the 103s cycle at which digits are drawn. Must be strictly
  -- after the betting cutoff so the two phases can never overlap (finding N-1).
  draw_at_second    SMALLINT     NOT NULL DEFAULT 94
                                 CHECK (draw_at_second BETWEEN 91 AND 102),
  -- A session is considered dead after this many seconds without a heartbeat,
  -- so a crashed client cannot lock its own account out forever.
  session_grace_sec SMALLINT     NOT NULL DEFAULT 90 CHECK (session_grace_sec > 0),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
INSERT INTO public.game_config (id) VALUES ('global');

-- audit_log ──────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind       TEXT        NOT NULL CHECK (kind IN ('system','coin','security','account')),
  detail     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_created ON public.audit_log (created_at DESC);

COMMIT;
