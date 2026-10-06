-- #############################################################################
-- LUCKY CARD - PHASE 1: CORE TABLES
-- Migration: 20261005050000_lucky_card_core_tables.sql
-- Spec: LUCKY_CARD_GAME_SPEC.md 14.8 (Phase 1), plus 2, 3, 4, 5, 6, 8
-- #############################################################################
--
-- PURELY ADDITIVE. Creates three new tables and touches NOTHING belonging to
-- Triple Chance: no ALTER, no DROP, no CREATE OR REPLACE over an existing
-- object. rounds, bets, coin_ledger, game_config and play_limits are not
-- referenced at all; profiles(id) is used only as a foreign key target, which
-- does not modify that table.
--
-- Phase 1 must precede Phase 2: Phase 2 adds coin_ledger.lucky_card_round_id
-- as a foreign key to lucky_card_rounds, which cannot exist until this runs.
--
-- SECURITY MODEL - mirrors Triple Chance, verified against the live catalogue
-- on 2026-10-05:
--   * RLS enabled on every table.
--   * SELECT-only policies. There are deliberately NO INSERT/UPDATE/DELETE
--     policies: every write goes through a SECURITY DEFINER function, exactly
--     as Triple Chance does.
--   * anon/authenticated get SELECT; service_role gets full DML.
--   * A player may not read an undrawn round. This is what stops a client
--     reading the winning card before the wheel lands; the client receives a
--     filtered view through an RPC instead.
-- #############################################################################

BEGIN;

-- =============================================================================
-- lucky_card_rounds
-- =============================================================================
-- One row per 103-second round (spec 6). round_number is floor(epoch / 103),
-- the same derivation and the same divisor Triple Chance uses.
--
-- rtp_percentage and bonus_multiplier are PINNED ONTO THE ROUND at creation
-- (spec 5, Q26) so a mid-round dashboard change cannot retroactively alter a
-- round already running. Ranges are Lucky Card specific: RTP 30-100 default
-- 90, against Triple Chance 50-100 default 96; bonus 1-10, against 1-4.
CREATE TABLE public.lucky_card_rounds (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number     BIGINT       NOT NULL UNIQUE,
  phase            TEXT         NOT NULL DEFAULT 'betting'
                                CHECK (phase IN ('betting','drawing','settled')),

  -- The drawn card. NULL until drawn; the two resolve together.
  winning_rank     TEXT         CHECK (winning_rank IN ('J','Q','K')),
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

  -- The card arrives whole or not at all. A rank without a suit is not a card.
  CONSTRAINT lucky_card_rounds_result_complete CHECK (
    (winning_rank IS NULL     AND winning_suit IS NULL) OR
    (winning_rank IS NOT NULL AND winning_suit IS NOT NULL)
  ),
  CONSTRAINT lucky_card_rounds_settled_has_result CHECK (
    phase <> 'settled' OR winning_rank IS NOT NULL
  )
);

CREATE INDEX idx_lucky_card_rounds_number  ON public.lucky_card_rounds (round_number DESC);
CREATE INDEX idx_lucky_card_rounds_phase   ON public.lucky_card_rounds (phase, round_number DESC);
-- Mirrors the rounds_pending_idx pattern: the ticker only looks for rounds
-- that are not yet finished, so keep that set small and indexed.
CREATE INDEX idx_lucky_card_rounds_pending ON public.lucky_card_rounds (round_number)
  WHERE winning_rank IS NULL OR phase <> 'settled';

-- =============================================================================
-- lucky_card_bets
-- =============================================================================
-- One row per player per round (spec 3). Twelve explicit stake columns rather
-- than a JSONB map, chosen deliberately over the Triple Chance JSONB approach:
--
--   * The 5 / 50,000 per-card limit (spec 8, Q28) becomes a CHECK the database
--     itself enforces on EVERY column. No caller can bypass it, which is what
--     Q28 requires; a JSONB map would leave the limit to application code.
--   * A mistyped key is impossible. The v1 JSONB keys arrived in padded,
--     unpadded and integer forms, which the v2 rebuild header records as the
--     source of several payout mismatches.
--   * The deck is permanently fixed at twelve cards, so the usual cost of wide
--     fixed columns - needing a migration to add another - never arrives.
--
-- A stake is either 0 (no bet on that card) or between the min and the max.
CREATE TABLE public.lucky_card_bets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     UUID        NOT NULL REFERENCES public.lucky_card_rounds(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.profiles(id)          ON DELETE CASCADE,

  j_hearts     BIGINT NOT NULL DEFAULT 0 CHECK (j_hearts   = 0 OR j_hearts   BETWEEN 5 AND 50000),
  j_spades     BIGINT NOT NULL DEFAULT 0 CHECK (j_spades   = 0 OR j_spades   BETWEEN 5 AND 50000),
  j_diamonds   BIGINT NOT NULL DEFAULT 0 CHECK (j_diamonds = 0 OR j_diamonds BETWEEN 5 AND 50000),
  j_clubs      BIGINT NOT NULL DEFAULT 0 CHECK (j_clubs    = 0 OR j_clubs    BETWEEN 5 AND 50000),
  q_hearts     BIGINT NOT NULL DEFAULT 0 CHECK (q_hearts   = 0 OR q_hearts   BETWEEN 5 AND 50000),
  q_spades     BIGINT NOT NULL DEFAULT 0 CHECK (q_spades   = 0 OR q_spades   BETWEEN 5 AND 50000),
  q_diamonds   BIGINT NOT NULL DEFAULT 0 CHECK (q_diamonds = 0 OR q_diamonds BETWEEN 5 AND 50000),
  q_clubs      BIGINT NOT NULL DEFAULT 0 CHECK (q_clubs    = 0 OR q_clubs    BETWEEN 5 AND 50000),
  k_hearts     BIGINT NOT NULL DEFAULT 0 CHECK (k_hearts   = 0 OR k_hearts   BETWEEN 5 AND 50000),
  k_spades     BIGINT NOT NULL DEFAULT 0 CHECK (k_spades   = 0 OR k_spades   BETWEEN 5 AND 50000),
  k_diamonds   BIGINT NOT NULL DEFAULT 0 CHECK (k_diamonds = 0 OR k_diamonds BETWEEN 5 AND 50000),
  k_clubs      BIGINT NOT NULL DEFAULT 0 CHECK (k_clubs    = 0 OR k_clubs    BETWEEN 5 AND 50000),

  total_stake  BIGINT      NOT NULL DEFAULT 0 CHECK (total_stake  >= 0),
  total_payout BIGINT      NOT NULL DEFAULT 0 CHECK (total_payout >= 0),
  is_settled   BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at   TIMESTAMPTZ,

  CONSTRAINT lucky_card_bets_one_per_round UNIQUE (round_id, user_id),

  -- total_stake is derived, never independently set. Stating it as a CHECK
  -- makes a mismatch impossible rather than merely unlikely.
  CONSTRAINT lucky_card_bets_stake_sum CHECK (
    total_stake = j_hearts + j_spades + j_diamonds + j_clubs
                + q_hearts + q_spades + q_diamonds + q_clubs
                + k_hearts + k_spades + k_diamonds + k_clubs
  )
);

CREATE INDEX idx_lucky_card_bets_user      ON public.lucky_card_bets (user_id, created_at DESC);
CREATE INDEX idx_lucky_card_bets_round     ON public.lucky_card_bets (round_id);
CREATE INDEX idx_lucky_card_bets_unsettled ON public.lucky_card_bets (round_id) WHERE NOT is_settled;

-- =============================================================================
-- lucky_card_config
-- =============================================================================
-- Single-row operator settings, mirroring the game_config shape. Lucky Card
-- stake limits are deliberately NOT here: spec 8 fixes them at 5 / 50,000 and
-- they are enforced as CHECK constraints on lucky_card_bets above, which is
-- what hardcoded and enforced-server-side (Q28) together mean.
CREATE TABLE public.lucky_card_config (
  id                 TEXT         PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),

  rtp_percentage     NUMERIC(5,2) NOT NULL DEFAULT 90.00
                                  CHECK (rtp_percentage BETWEEN 30 AND 100),
  bonus_multiplier   SMALLINT     NOT NULL DEFAULT 1
                                  CHECK (bonus_multiplier BETWEEN 1 AND 10),

  -- Positions within the 103-second cycle (spec 6).
  bet_cutoff_second  SMALLINT     NOT NULL DEFAULT 88
                                  CHECK (bet_cutoff_second BETWEEN 1 AND 99),
  draw_at_second     SMALLINT     NOT NULL DEFAULT 89
                                  CHECK (draw_at_second BETWEEN 1 AND 100),

  settle_batch_size  INTEGER      NOT NULL DEFAULT 3000
                                  CHECK (settle_batch_size BETWEEN 1 AND 20000),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- The draw must never happen while bets are still accepted. Triple Chance
  -- shipped that overlap to production once (20260806120000_fix_rtp_timing),
  -- where it rejected every bet in the round AND silently disabled RTP
  -- targeting for 140 rounds.
  CONSTRAINT lucky_card_config_cutoff_before_draw CHECK (bet_cutoff_second < draw_at_second)
);

INSERT INTO public.lucky_card_config (id) VALUES ('global');

-- =============================================================================
-- SECURITY - RLS and grants, mirroring Triple Chance
-- =============================================================================
ALTER TABLE public.lucky_card_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lucky_card_bets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lucky_card_config ENABLE ROW LEVEL SECURITY;

-- Players see only SETTLED rounds. Mirrors rounds_select_settled, and is what
-- prevents a client reading the winning card before the wheel has landed.
CREATE POLICY lucky_card_rounds_select ON public.lucky_card_rounds
  FOR SELECT USING (
    (phase = 'settled' OR current_role_name() = 'superadmin') AND current_is_active()
  );

-- A player sees their own bets; a superadmin sees all; an agent sees the bets
-- of players assigned to them. Mirrors bets_select.
CREATE POLICY lucky_card_bets_select ON public.lucky_card_bets
  FOR SELECT USING (
    (
      user_id = auth.uid()
      OR current_role_name() = 'superadmin'
      OR (current_role_name() = 'agent' AND user_id IN (
            SELECT p.id FROM public.profiles p WHERE p.agent_id = auth.uid()
          ))
    ) AND current_is_active()
  );

-- Operator settings are staff-only. Mirrors game_config_select.
CREATE POLICY lucky_card_config_select ON public.lucky_card_config
  FOR SELECT USING (
    current_role_name() IN ('agent','superadmin') AND current_is_active()
  );

-- No INSERT/UPDATE/DELETE policies, deliberately. Every write goes through a
-- SECURITY DEFINER function (Phase 3), exactly as Triple Chance does.

GRANT SELECT ON public.lucky_card_rounds, public.lucky_card_bets, public.lucky_card_config
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lucky_card_rounds, public.lucky_card_bets, public.lucky_card_config
  TO service_role;

COMMIT;
