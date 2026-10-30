-- #############################################################################
-- LUCKY 16 CARD - STEP 2: CORE TABLES
-- Migration: 20261028120000_lucky16_core_tables.sql
-- Plan: "Lucky 16 Card: build plan" step 2 (approved by Hasan 2026-10-28)
-- #############################################################################
--
-- PURELY ADDITIVE. Creates three new tables and touches NOTHING belonging to
-- Triple Chance, Lucky Card or Spin2Win: no ALTER, no DROP, no CREATE OR
-- REPLACE over an existing object. profiles(id) is used only as a foreign key
-- target, which does not modify that table.
--
-- Step 2 must precede Step 3: Step 3 adds coin_ledger.lucky16_round_id as a
-- foreign key to lucky16_rounds, which cannot exist until this runs.
--
-- Lucky 16 Card is Lucky Card with 16 cards: ranks A, J, Q, K in the four
-- suits. Rules confirmed by Hasan 2026-10-28:
--   * payout 14x the stake on the winning card, times the round's bonus;
--   * RTP 30-100, default 90 (a fair draw is 14 / 16 = 87.5%);
--   * bonus 1 (N) to 10, pinned to the round at creation;
--   * per card: 0, or min 5 to max 10,000 (hard rule, no admin control);
--   * 103-second cycle, cutoff second 88, draw second 89 (same as Lucky Card).
--
-- SECURITY MODEL - identical to lucky_card_* and spin2win_*:
--   * RLS enabled on every table.
--   * SELECT-only policies. There are deliberately NO INSERT/UPDATE/DELETE
--     policies: every write goes through a SECURITY DEFINER function.
--   * anon/authenticated get SELECT only; service_role gets full DML.
--   * A player may not read an undrawn round, so a client can never read the
--     winning card before the wheel lands.
-- #############################################################################

BEGIN;

-- =============================================================================
-- lucky16_rounds
-- =============================================================================
-- One row per 103-second round. rtp_percentage and bonus_multiplier are PINNED
-- ONTO THE ROUND at creation so a mid-round dashboard change cannot alter a
-- round already running. bonus_multiplier 1 = N (no bonus), 2..10 = 2X..10X.
CREATE TABLE public.lucky16_rounds (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number     BIGINT       NOT NULL UNIQUE,
  phase            TEXT         NOT NULL DEFAULT 'betting'
                                CHECK (phase IN ('betting','drawing','settled')),

  -- The drawn card. Both NULL until drawn.
  winning_rank     TEXT         CHECK (winning_rank IN ('A','J','Q','K')),
  winning_suit     TEXT         CHECK (winning_suit IN ('hearts','spades','diamonds','clubs')),

  total_stake      BIGINT       NOT NULL DEFAULT 0 CHECK (total_stake  >= 0),
  total_payout     BIGINT       NOT NULL DEFAULT 0 CHECK (total_payout >= 0),

  rtp_percentage   NUMERIC(5,2) NOT NULL DEFAULT 90.00
                                CHECK (rtp_percentage BETWEEN 30 AND 100),
  bonus_multiplier SMALLINT     NOT NULL DEFAULT 1
                                CHECK (bonus_multiplier BETWEEN 1 AND 10),

  scheduled_at     TIMESTAMPTZ  NOT NULL,
  drawn_at         TIMESTAMPTZ,
  settled_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- A result is either absent or complete (rank and suit together).
  CONSTRAINT lucky16_rounds_result_complete CHECK (
    (winning_rank IS NULL     AND winning_suit IS NULL) OR
    (winning_rank IS NOT NULL AND winning_suit IS NOT NULL)
  ),
  CONSTRAINT lucky16_rounds_settled_has_result CHECK (
    phase <> 'settled' OR winning_rank IS NOT NULL
  )
);

CREATE INDEX idx_lucky16_rounds_number  ON public.lucky16_rounds (round_number DESC);
CREATE INDEX idx_lucky16_rounds_phase   ON public.lucky16_rounds (phase, round_number DESC);
-- The ticker only looks for rounds that are not yet finished; keep that set
-- small and indexed (same pattern as idx_lucky_card_rounds_pending).
CREATE INDEX idx_lucky16_rounds_pending ON public.lucky16_rounds (round_number)
  WHERE winning_rank IS NULL OR phase <> 'settled';

-- =============================================================================
-- lucky16_bets
-- =============================================================================
-- One row per player per round, with the stake on each of the 16 cards. The
-- suit bars and the A/J/Q/K selectors are app shortcuts only: they arrive here
-- as ordinary per-card stakes. A stake is 0 (no bet on that card) or between
-- 5 and 10,000, enforced by the database on every column.
CREATE TABLE public.lucky16_bets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     UUID        NOT NULL REFERENCES public.lucky16_rounds(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,

  a_hearts     BIGINT NOT NULL DEFAULT 0 CHECK (a_hearts   = 0 OR a_hearts   BETWEEN 5 AND 10000),
  a_spades     BIGINT NOT NULL DEFAULT 0 CHECK (a_spades   = 0 OR a_spades   BETWEEN 5 AND 10000),
  a_diamonds   BIGINT NOT NULL DEFAULT 0 CHECK (a_diamonds = 0 OR a_diamonds BETWEEN 5 AND 10000),
  a_clubs      BIGINT NOT NULL DEFAULT 0 CHECK (a_clubs    = 0 OR a_clubs    BETWEEN 5 AND 10000),
  j_hearts     BIGINT NOT NULL DEFAULT 0 CHECK (j_hearts   = 0 OR j_hearts   BETWEEN 5 AND 10000),
  j_spades     BIGINT NOT NULL DEFAULT 0 CHECK (j_spades   = 0 OR j_spades   BETWEEN 5 AND 10000),
  j_diamonds   BIGINT NOT NULL DEFAULT 0 CHECK (j_diamonds = 0 OR j_diamonds BETWEEN 5 AND 10000),
  j_clubs      BIGINT NOT NULL DEFAULT 0 CHECK (j_clubs    = 0 OR j_clubs    BETWEEN 5 AND 10000),
  q_hearts     BIGINT NOT NULL DEFAULT 0 CHECK (q_hearts   = 0 OR q_hearts   BETWEEN 5 AND 10000),
  q_spades     BIGINT NOT NULL DEFAULT 0 CHECK (q_spades   = 0 OR q_spades   BETWEEN 5 AND 10000),
  q_diamonds   BIGINT NOT NULL DEFAULT 0 CHECK (q_diamonds = 0 OR q_diamonds BETWEEN 5 AND 10000),
  q_clubs      BIGINT NOT NULL DEFAULT 0 CHECK (q_clubs    = 0 OR q_clubs    BETWEEN 5 AND 10000),
  k_hearts     BIGINT NOT NULL DEFAULT 0 CHECK (k_hearts   = 0 OR k_hearts   BETWEEN 5 AND 10000),
  k_spades     BIGINT NOT NULL DEFAULT 0 CHECK (k_spades   = 0 OR k_spades   BETWEEN 5 AND 10000),
  k_diamonds   BIGINT NOT NULL DEFAULT 0 CHECK (k_diamonds = 0 OR k_diamonds BETWEEN 5 AND 10000),
  k_clubs      BIGINT NOT NULL DEFAULT 0 CHECK (k_clubs    = 0 OR k_clubs    BETWEEN 5 AND 10000),

  total_stake  BIGINT      NOT NULL DEFAULT 0 CHECK (total_stake  >= 0),
  total_payout BIGINT      NOT NULL DEFAULT 0 CHECK (total_payout >= 0),
  is_settled   BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at   TIMESTAMPTZ,

  CONSTRAINT lucky16_bets_one_per_round UNIQUE (round_id, user_id),

  -- total_stake is derived from the 16 cards, never independently set.
  CONSTRAINT lucky16_bets_stake_sum CHECK (
    total_stake = a_hearts + a_spades + a_diamonds + a_clubs
                + j_hearts + j_spades + j_diamonds + j_clubs
                + q_hearts + q_spades + q_diamonds + q_clubs
                + k_hearts + k_spades + k_diamonds + k_clubs
  )
);

CREATE INDEX idx_lucky16_bets_user      ON public.lucky16_bets (user_id, created_at DESC);
CREATE INDEX idx_lucky16_bets_round     ON public.lucky16_bets (round_id);
CREATE INDEX idx_lucky16_bets_unsettled ON public.lucky16_bets (round_id) WHERE NOT is_settled;

-- =============================================================================
-- lucky16_config
-- =============================================================================
-- Single-row operator settings, same shape as lucky_card_config. Stake limits
-- are deliberately NOT here: they are fixed and enforced by lucky16_bets.
-- bonus_multiplier is the bonus applied to the NEXT round created (default
-- 1 = N). The dashboard can also boost the round already running (Step 7).
CREATE TABLE public.lucky16_config (
  id                 TEXT         PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),

  rtp_percentage     NUMERIC(5,2) NOT NULL DEFAULT 90.00
                                  CHECK (rtp_percentage BETWEEN 30 AND 100),
  bonus_multiplier   SMALLINT     NOT NULL DEFAULT 1
                                  CHECK (bonus_multiplier BETWEEN 1 AND 10),

  -- Positions within the 103-second cycle, as Lucky Card: the app sends the
  -- board at timer 05 (second 85), the server stops accepting at 88 and draws
  -- at 89.
  bet_cutoff_second  SMALLINT     NOT NULL DEFAULT 88
                                  CHECK (bet_cutoff_second BETWEEN 1 AND 99),
  draw_at_second     SMALLINT     NOT NULL DEFAULT 89
                                  CHECK (draw_at_second BETWEEN 1 AND 100),

  settle_batch_size  INTEGER      NOT NULL DEFAULT 3000
                                  CHECK (settle_batch_size BETWEEN 1 AND 20000),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- The draw must never happen while bets are still accepted.
  CONSTRAINT lucky16_config_cutoff_before_draw CHECK (bet_cutoff_second < draw_at_second)
);

INSERT INTO public.lucky16_config (id) VALUES ('global');

-- =============================================================================
-- SECURITY - RLS and grants, identical to lucky_card_* and spin2win_*
-- =============================================================================
ALTER TABLE public.lucky16_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lucky16_bets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lucky16_config ENABLE ROW LEVEL SECURITY;

-- Players see only SETTLED rounds.
CREATE POLICY lucky16_rounds_select ON public.lucky16_rounds
  FOR SELECT USING (
    (phase = 'settled' OR current_role_name() = 'superadmin') AND current_is_active()
  );

-- A player sees their own bets; a superadmin sees all; an agent sees the bets
-- of players assigned to them.
CREATE POLICY lucky16_bets_select ON public.lucky16_bets
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
CREATE POLICY lucky16_config_select ON public.lucky16_config
  FOR SELECT USING (
    current_role_name() IN ('agent','superadmin') AND current_is_active()
  );

-- No INSERT/UPDATE/DELETE policies, deliberately. Every write goes through a
-- SECURITY DEFINER function (Steps 4-7).

GRANT SELECT ON public.lucky16_rounds, public.lucky16_bets, public.lucky16_config
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lucky16_rounds, public.lucky16_bets, public.lucky16_config
  TO service_role;

-- This database's default privileges grant anon/authenticated full DML,
-- including TRUNCATE (which RLS does not block), on every new public table.
-- Take them away so clients can only read.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.lucky16_rounds, public.lucky16_bets, public.lucky16_config
  FROM anon, authenticated;

COMMIT;
