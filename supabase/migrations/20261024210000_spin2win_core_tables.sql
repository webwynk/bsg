-- #############################################################################
-- SPIN2WIN - STEP 2: CORE TABLES
-- Migration: 20261024210000_spin2win_core_tables.sql
-- Plan: /spin2win/SPIN2WIN_BUILD_PLAN.md step 2 (bet layout option A, chosen
--       by the user 2026-10-24)
-- #############################################################################
--
-- PURELY ADDITIVE. Creates three new tables and touches NOTHING belonging to
-- Triple Chance or Lucky Card: no ALTER, no DROP, no CREATE OR REPLACE over an
-- existing object. rounds, bets, lucky_card_*, coin_ledger, game_config and
-- play_limits are not referenced at all; profiles(id) is used only as a
-- foreign key target, which does not modify that table.
--
-- Step 2 must precede Step 3: Step 3 adds coin_ledger.spin2win_round_id as a
-- foreign key to spin2win_rounds, which cannot exist until this runs.
--
-- SECURITY MODEL - same end state as lucky_card_* (verified live 2026-10-24, Step 1):
--   * RLS enabled on every table.
--   * SELECT-only policies. There are deliberately NO INSERT/UPDATE/DELETE
--     policies: every write goes through a SECURITY DEFINER function.
--   * anon/authenticated end with SELECT only (plus the harmless REFERENCES,
--     TRIGGER, MAINTAIN): the default INSERT/UPDATE/DELETE/TRUNCATE rights this
--     database grants on every new public table are REVOKED at the end of this
--     file. service_role keeps full DML.
--   * A player may not read an undrawn round, so a client can never read the
--     winning number before the wheel lands.
-- #############################################################################

BEGIN;

-- =============================================================================
-- spin2win_rounds
-- =============================================================================
-- One row per 100-second round. round_number is floor(epoch / 100). The cycle
-- is 90 s of betting, the draw at second 90 (timer 00), a 4 s spin and a 6 s
-- result window (user decision 2026-10-24).
--
-- rtp_percentage and bonus_multiplier are PINNED ONTO THE ROUND at creation so
-- a mid-round dashboard change cannot retroactively alter a round already
-- running. bonus_multiplier 1 = N (no bonus), 2/3/4 = 2x/3x/4x.
CREATE TABLE public.spin2win_rounds (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number     BIGINT       NOT NULL UNIQUE,
  phase            TEXT         NOT NULL DEFAULT 'betting'
                                CHECK (phase IN ('betting','drawing','settled')),

  -- The drawn number. NULL until drawn.
  winning_number   SMALLINT     CHECK (winning_number BETWEEN 0 AND 9),

  total_stake      BIGINT       NOT NULL DEFAULT 0 CHECK (total_stake  >= 0),
  total_payout     BIGINT       NOT NULL DEFAULT 0 CHECK (total_payout >= 0),

  rtp_percentage   NUMERIC(5,2) NOT NULL DEFAULT 90.00
                                CHECK (rtp_percentage BETWEEN 30 AND 100),
  bonus_multiplier SMALLINT     NOT NULL DEFAULT 1
                                CHECK (bonus_multiplier BETWEEN 1 AND 4),

  scheduled_at     TIMESTAMPTZ  NOT NULL,
  drawn_at         TIMESTAMPTZ,
  settled_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT spin2win_rounds_settled_has_result CHECK (
    phase <> 'settled' OR winning_number IS NOT NULL
  )
);

CREATE INDEX idx_spin2win_rounds_number  ON public.spin2win_rounds (round_number DESC);
CREATE INDEX idx_spin2win_rounds_phase   ON public.spin2win_rounds (phase, round_number DESC);
-- The ticker only looks for rounds that are not yet finished; keep that set
-- small and indexed (same pattern as idx_lucky_card_rounds_pending).
CREATE INDEX idx_spin2win_rounds_pending ON public.spin2win_rounds (round_number)
  WHERE winning_number IS NULL OR phase <> 'settled';

-- =============================================================================
-- spin2win_bets
-- =============================================================================
-- One row per player per round. Ten explicit stake columns n0..n9 (option A),
-- so the fixed 5 / 10,000 per-number limit (user decision 2026-10-24: hard
-- rule, no admin control) is a CHECK the database itself enforces on every
-- column. ODD / EVEN are not bet types: the app spreads the chip onto each
-- odd or even number, so they arrive here as ordinary per-number stakes.
--
-- A stake is either 0 (no bet on that number) or between 5 and 10,000.
CREATE TABLE public.spin2win_bets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     UUID        NOT NULL REFERENCES public.spin2win_rounds(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.profiles(id)        ON DELETE CASCADE,

  n0           BIGINT NOT NULL DEFAULT 0 CHECK (n0 = 0 OR n0 BETWEEN 5 AND 10000),
  n1           BIGINT NOT NULL DEFAULT 0 CHECK (n1 = 0 OR n1 BETWEEN 5 AND 10000),
  n2           BIGINT NOT NULL DEFAULT 0 CHECK (n2 = 0 OR n2 BETWEEN 5 AND 10000),
  n3           BIGINT NOT NULL DEFAULT 0 CHECK (n3 = 0 OR n3 BETWEEN 5 AND 10000),
  n4           BIGINT NOT NULL DEFAULT 0 CHECK (n4 = 0 OR n4 BETWEEN 5 AND 10000),
  n5           BIGINT NOT NULL DEFAULT 0 CHECK (n5 = 0 OR n5 BETWEEN 5 AND 10000),
  n6           BIGINT NOT NULL DEFAULT 0 CHECK (n6 = 0 OR n6 BETWEEN 5 AND 10000),
  n7           BIGINT NOT NULL DEFAULT 0 CHECK (n7 = 0 OR n7 BETWEEN 5 AND 10000),
  n8           BIGINT NOT NULL DEFAULT 0 CHECK (n8 = 0 OR n8 BETWEEN 5 AND 10000),
  n9           BIGINT NOT NULL DEFAULT 0 CHECK (n9 = 0 OR n9 BETWEEN 5 AND 10000),

  total_stake  BIGINT      NOT NULL DEFAULT 0 CHECK (total_stake  >= 0),
  total_payout BIGINT      NOT NULL DEFAULT 0 CHECK (total_payout >= 0),
  is_settled   BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at   TIMESTAMPTZ,

  CONSTRAINT spin2win_bets_one_per_round UNIQUE (round_id, user_id),

  -- total_stake is derived, never independently set.
  CONSTRAINT spin2win_bets_stake_sum CHECK (
    total_stake = n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7 + n8 + n9
  )
);

CREATE INDEX idx_spin2win_bets_user      ON public.spin2win_bets (user_id, created_at DESC);
CREATE INDEX idx_spin2win_bets_round     ON public.spin2win_bets (round_id);
CREATE INDEX idx_spin2win_bets_unsettled ON public.spin2win_bets (round_id) WHERE NOT is_settled;

-- =============================================================================
-- spin2win_config
-- =============================================================================
-- Single-row operator settings, same shape as lucky_card_config. Stake limits
-- are deliberately NOT here: they are fixed and enforced by spin2win_bets.
--
-- bonus_multiplier is the bonus applied to the NEXT round created (default
-- 1 = N). The dashboard can also boost the round already running (Step 7).
-- RTP default 90.00: 10 numbers paying 9x makes 90% an exactly fair draw.
CREATE TABLE public.spin2win_config (
  id                 TEXT         PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),

  rtp_percentage     NUMERIC(5,2) NOT NULL DEFAULT 90.00
                                  CHECK (rtp_percentage BETWEEN 30 AND 100),
  bonus_multiplier   SMALLINT     NOT NULL DEFAULT 1
                                  CHECK (bonus_multiplier BETWEEN 1 AND 4),

  -- Positions within the 100-second cycle. Timer 05 = second 85 (app sends
  -- the board); the server stops accepting at 88; the draw is at 90 (timer 00).
  bet_cutoff_second  SMALLINT     NOT NULL DEFAULT 88
                                  CHECK (bet_cutoff_second BETWEEN 1 AND 98),
  draw_at_second     SMALLINT     NOT NULL DEFAULT 90
                                  CHECK (draw_at_second BETWEEN 1 AND 99),

  settle_batch_size  INTEGER      NOT NULL DEFAULT 3000
                                  CHECK (settle_batch_size BETWEEN 1 AND 20000),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- The draw must never happen while bets are still accepted.
  CONSTRAINT spin2win_config_cutoff_before_draw CHECK (bet_cutoff_second < draw_at_second)
);

INSERT INTO public.spin2win_config (id) VALUES ('global');

-- =============================================================================
-- SECURITY - RLS and grants, identical to lucky_card_*
-- =============================================================================
ALTER TABLE public.spin2win_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spin2win_bets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spin2win_config ENABLE ROW LEVEL SECURITY;

-- Players see only SETTLED rounds.
CREATE POLICY spin2win_rounds_select ON public.spin2win_rounds
  FOR SELECT USING (
    (phase = 'settled' OR current_role_name() = 'superadmin') AND current_is_active()
  );

-- A player sees their own bets; a superadmin sees all; an agent sees the bets
-- of players assigned to them.
CREATE POLICY spin2win_bets_select ON public.spin2win_bets
  FOR SELECT USING (
    (
      user_id = auth.uid()
      OR current_role_name() = 'superadmin'
      OR (current_role_name() = 'agent' AND user_id IN (
            SELECT p.id FROM public.profiles p WHERE p.agent_id = auth.uid()
          ))
    ) AND current_is_active()
  );

-- Operator settings are staff-only.
CREATE POLICY spin2win_config_select ON public.spin2win_config
  FOR SELECT USING (
    current_role_name() IN ('agent','superadmin') AND current_is_active()
  );

-- No INSERT/UPDATE/DELETE policies, deliberately. Every write goes through a
-- SECURITY DEFINER function (Steps 4-7).

GRANT SELECT ON public.spin2win_rounds, public.spin2win_bets, public.spin2win_config
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spin2win_rounds, public.spin2win_bets, public.spin2win_config
  TO service_role;

-- This database's default privileges grant anon/authenticated full DML,
-- including TRUNCATE (which RLS does not block), on every new public table.
-- Take them away so clients can only read (Lucky Card needed a follow-up
-- migration, 20261005160000, for exactly this).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.spin2win_rounds, public.spin2win_bets, public.spin2win_config
  FROM anon, authenticated;

COMMIT;
