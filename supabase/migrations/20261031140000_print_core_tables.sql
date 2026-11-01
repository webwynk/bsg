-- #############################################################################
-- PRINT TICKETS - PHASE 1, STEP 1: CORE TABLES
-- Migration: 20261031140000_print_core_tables.sql
-- Plan: "Print ticket function: phase plan", P1 (approved by Hasan 2026-10-31)
-- #############################################################################
--
-- ADDITIVE. Creates four new tables. No existing table, column, function,
-- policy or row is changed. profiles and the four round tables are used only as
-- foreign key targets, which does not modify them. Needs account_codes
-- (20261031120000), which holds each player's ID.
--
-- Nothing here takes a bet, moves a coin or changes a payout. Each game keeps
-- its one bet row per player per round as the round total; a ticket is a record
-- beside it. The functions that write these tables are in
-- 20261031150000_print_functions.sql; the per-game Print functions come later.
--
-- A printed ticket is a financial record, so its foreign keys are RESTRICT: an
-- account or round with tickets cannot be deleted by accident.
--
-- APPLYING. Adding a foreign key briefly locks the target table against writes,
-- and every bet writes profiles and a round table. lock_timeout makes the file
-- fail cleanly rather than hold bets up. Apply between rounds; a timeout changes
-- nothing and can be retried.
--
-- SECURITY: as account_codes. RLS on, SELECT only for clients, every write
-- through a SECURITY DEFINER function.
-- #############################################################################

BEGIN;

SET LOCAL lock_timeout = '3s';

-- =============================================================================
-- print_settings: the kill switch
-- =============================================================================
-- One row. Off until Print is released. When off, no new ticket can be made.
CREATE TABLE public.print_settings (
  id         TEXT        PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  enabled    BOOLEAN     NOT NULL DEFAULT false,
  updated_by UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.print_settings (id) VALUES ('global');

-- =============================================================================
-- print_players: who uses Print
-- =============================================================================
-- A change takes effect from the next round (Hasan, D7), so one round is either
-- all printed or all board bets. `enabled` is the latest choice and applies from
-- effective_round; `active_before` is what applies to earlier rounds. See
-- print_active_for_round. The player's ID is account_codes.code, not stored here.
CREATE TABLE public.print_players (
  user_id         UUID        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  enabled         BOOLEAN     NOT NULL DEFAULT false,
  active_before   BOOLEAN     NOT NULL DEFAULT false,
  effective_round BIGINT      NOT NULL,
  enabled_at      TIMESTAMPTZ,
  enabled_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- print_counters: the last ticket number per player per game
-- =============================================================================
-- Only ever goes up, so a ticket number never restarts or repeats.
CREATE TABLE public.print_counters (
  user_id     UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  game        TEXT    NOT NULL CHECK (game IN ('TC','SW','LC','LS')),
  last_number BIGINT  NOT NULL CHECK (last_number >= 1),

  PRIMARY KEY (user_id, game)
);

-- =============================================================================
-- print_tickets
-- =============================================================================
-- One row per printed ticket. Exactly one round reference is filled, the one
-- for the ticket's own game, the same way coin_ledger names its round.
-- round_number is kept too, because it is printed on the ticket.
-- items is the ticket's own board, in the shape of that game's bet.
-- client_request_id is made once per Print press: UNIQUE per player, it stops a
-- double press or a retry charging twice.
CREATE TABLE public.print_tickets (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game                TEXT        NOT NULL CHECK (game IN ('TC','SW','LC','LS')),
  ticket_no           BIGINT      NOT NULL CHECK (ticket_no >= 1),
  ticket_code         TEXT        NOT NULL UNIQUE,
  user_id             UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  round_id            UUID        REFERENCES public.rounds(id)            ON DELETE RESTRICT,
  lucky_card_round_id UUID        REFERENCES public.lucky_card_rounds(id) ON DELETE RESTRICT,
  spin2win_round_id   UUID        REFERENCES public.spin2win_rounds(id)   ON DELETE RESTRICT,
  lucky16_round_id    UUID        REFERENCES public.lucky16_rounds(id)    ON DELETE RESTRICT,
  round_number        BIGINT      NOT NULL,

  items               JSONB       NOT NULL,
  total_stake         BIGINT      NOT NULL CHECK (total_stake > 0),
  client_request_id   UUID        NOT NULL,
  print_status        TEXT        NOT NULL DEFAULT 'charged'
                                  CHECK (print_status IN ('charged','printed','not_printed','failed')),
  reprint_count       INTEGER     NOT NULL DEFAULT 0 CHECK (reprint_count >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT print_tickets_one_number UNIQUE (game, user_id, ticket_no),
  CONSTRAINT print_tickets_one_per_press UNIQUE (user_id, client_request_id),

  -- Exactly one round, and it is the ticket's own game's.
  CONSTRAINT print_tickets_one_round CHECK (
    num_nonnulls(round_id, lucky_card_round_id, spin2win_round_id, lucky16_round_id) = 1
  ),
  CONSTRAINT print_tickets_round_matches_game CHECK (
    (game = 'TC' AND round_id            IS NOT NULL) OR
    (game = 'LC' AND lucky_card_round_id IS NOT NULL) OR
    (game = 'SW' AND spin2win_round_id   IS NOT NULL) OR
    (game = 'LS' AND lucky16_round_id    IS NOT NULL)
  )
);

CREATE INDEX idx_print_tickets_user       ON public.print_tickets (user_id, created_at DESC);
CREATE INDEX idx_print_tickets_tc_round   ON public.print_tickets (round_id)            WHERE round_id IS NOT NULL;
CREATE INDEX idx_print_tickets_lc_round   ON public.print_tickets (lucky_card_round_id) WHERE lucky_card_round_id IS NOT NULL;
CREATE INDEX idx_print_tickets_sw_round   ON public.print_tickets (spin2win_round_id)   WHERE spin2win_round_id IS NOT NULL;
CREATE INDEX idx_print_tickets_ls_round   ON public.print_tickets (lucky16_round_id)    WHERE lucky16_round_id IS NOT NULL;

-- =============================================================================
-- SECURITY
-- =============================================================================
ALTER TABLE public.print_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_players  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_tickets  ENABLE ROW LEVEL SECURITY;

-- Whether Print is switched on is not a secret; the app needs to read it.
CREATE POLICY print_settings_select ON public.print_settings
  FOR SELECT USING (current_is_active());

-- A player sees their own; a superadmin all; an agent their own players.
CREATE POLICY print_players_select ON public.print_players
  FOR SELECT USING (
    (
      user_id = auth.uid()
      OR current_role_name() = 'superadmin'
      OR (current_role_name() = 'agent' AND user_id IN (
            SELECT p.id FROM public.profiles p WHERE p.agent_id = auth.uid()
          ))
    ) AND current_is_active()
  );

CREATE POLICY print_tickets_select ON public.print_tickets
  FOR SELECT USING (
    (
      user_id = auth.uid()
      OR current_role_name() = 'superadmin'
      OR (current_role_name() = 'agent' AND user_id IN (
            SELECT p.id FROM public.profiles p WHERE p.agent_id = auth.uid()
          ))
    ) AND current_is_active()
  );

-- print_counters has no policy: no client reads it.

GRANT SELECT ON public.print_settings, public.print_players, public.print_tickets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.print_settings, public.print_players, public.print_counters, public.print_tickets
  TO service_role;

-- This database's default privileges grant anon/authenticated full DML,
-- including TRUNCATE (which RLS does not block), on every new public table.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.print_settings, public.print_players, public.print_tickets
  FROM anon, authenticated;
REVOKE ALL ON public.print_counters FROM anon, authenticated;

COMMENT ON TABLE public.print_settings IS
  'One row: the Print kill switch. Off until released. Off stops new tickets.';
COMMENT ON TABLE public.print_players IS
  'Who uses Print. A change applies from effective_round; see print_active_for_round.';
COMMENT ON TABLE public.print_counters IS
  'The last ticket number per player per game. Only ever goes up.';
COMMENT ON TABLE public.print_tickets IS
  'One row per printed ticket: a record beside the round bet row, never paid '
  'separately. client_request_id stops a repeat press charging twice.';

COMMIT;
