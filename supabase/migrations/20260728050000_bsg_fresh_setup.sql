-- =============================================================================
-- BSG FRESH DATABASE SETUP
-- Migration: 20260728050000_bsg_fresh_setup.sql
-- =============================================================================
-- ARCHITECTURE:
--   GLOBAL:  profiles, active_sessions, transactions (game_name tagged)
--   TRIPLE CHANCE: triple_chance_rounds, triple_chance_bets, play_limits
--
-- ROUND CYCLE: 103 seconds (90s betting + 13s spin) — matches Flutter client
-- WIN NUMBERS: Deterministic MD5 hash of round_number (not random)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: CLEAN SLATE
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.triple_chance_bets       CASCADE;
DROP TABLE IF EXISTS public.triple_chance_rounds     CASCADE;
DROP TABLE IF EXISTS public.transactions             CASCADE;
DROP TABLE IF EXISTS public.active_sessions          CASCADE;
DROP TABLE IF EXISTS public.play_limits              CASCADE;
-- Note: public.profiles is managed by Supabase Auth trigger — do not drop

DROP FUNCTION IF EXISTS public.check_and_update_login_session(uuid, text);
DROP FUNCTION IF EXISTS public.update_user_heartbeat(uuid, text);
DROP FUNCTION IF EXISTS public.clear_user_session(uuid);
DROP FUNCTION IF EXISTS public.get_play_limits();
DROP FUNCTION IF EXISTS public.get_current_round();
DROP FUNCTION IF EXISTS public.get_recent_rounds(int);
DROP FUNCTION IF EXISTS public.submit_round_bet(uuid, jsonb, jsonb, jsonb, numeric);
DROP FUNCTION IF EXISTS public.get_my_round_result(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: GLOBAL TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- A. profiles — one row per player, global wallet
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  username    TEXT        NOT NULL UNIQUE,
  role        TEXT        NOT NULL DEFAULT 'player' CHECK (role IN ('player','agent','superadmin')),
  balance        NUMERIC     NOT NULL DEFAULT 0 CHECK (balance >= 0),
  ledger_version BIGINT      NOT NULL DEFAULT 1,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  agent_id    UUID        REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- B. active_sessions — single-session enforcement
CREATE TABLE IF NOT EXISTS public.active_sessions (
  user_id         UUID        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_token   TEXT        NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- C. transactions — ALL coin movements from ALL games (tagged by game_name)
CREATE TABLE IF NOT EXISTS public.transactions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES public.profiles(id),
  agent_id      UUID        REFERENCES public.profiles(id),
  game_name     TEXT        NOT NULL,   -- 'triple_chance' | 'spin2win' | 'system'
  type          TEXT        NOT NULL,   -- 'bet_stake' | 'win_payout' | 'agent_topup' | 'admin_adjustment'
  amount        NUMERIC     NOT NULL,   -- negative = deduction, positive = credit
  balance_after NUMERIC     NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user    ON public.transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_game    ON public.transactions (game_name, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: TRIPLE CHANCE GAME TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- D. triple_chance_rounds — round registry (win numbers pre-generated via MD5)
CREATE TABLE IF NOT EXISTS public.triple_chance_rounds (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number  BIGINT      NOT NULL UNIQUE,  -- epoch / 103
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'betting' CHECK (status IN ('betting','spinning','complete')),
  red           INT         CHECK (red   BETWEEN 0 AND 9),
  green         INT         CHECK (green BETWEEN 0 AND 9),
  black         INT         CHECK (black BETWEEN 0 AND 9),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_rounds_number ON public.triple_chance_rounds (round_number DESC);
CREATE INDEX IF NOT EXISTS idx_tc_rounds_status ON public.triple_chance_rounds (status, scheduled_at DESC);

-- E. triple_chance_bets — player bets per round
CREATE TABLE IF NOT EXISTS public.triple_chance_bets (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      UUID        NOT NULL REFERENCES public.triple_chance_rounds(id),
  user_id       UUID        NOT NULL REFERENCES public.profiles(id),
  single_bets   JSONB       NOT NULL DEFAULT '{}',  -- {"7": 1000}
  double_bets   JSONB       NOT NULL DEFAULT '{}',  -- {"42": 500}
  triple_bets   JSONB       NOT NULL DEFAULT '{}',  -- {"742": 100}
  total_stake   NUMERIC     NOT NULL DEFAULT 0,
  single_win    NUMERIC     NOT NULL DEFAULT 0,
  double_win    NUMERIC     NOT NULL DEFAULT 0,
  triple_win    NUMERIC     NOT NULL DEFAULT 0,
  win_amount    NUMERIC     NOT NULL DEFAULT 0,
  is_resolved   BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tc_bets_user   ON public.triple_chance_bets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_bets_round  ON public.triple_chance_bets (round_id);

-- F. play_limits — Triple Chance per-cell betting caps (admin configurable)
CREATE TABLE IF NOT EXISTS public.play_limits (
  id           TEXT    PRIMARY KEY DEFAULT 'global',
  single_min   NUMERIC NOT NULL DEFAULT 2,
  single_max   NUMERIC NOT NULL DEFAULT 10000,
  double_min   NUMERIC NOT NULL DEFAULT 2,
  double_max   NUMERIC NOT NULL DEFAULT 1000,
  triple_min   NUMERIC NOT NULL DEFAULT 2,
  triple_max   NUMERIC NOT NULL DEFAULT 100,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default limits immediately
INSERT INTO public.play_limits (id) VALUES ('global') ON CONFLICT DO NOTHING;

-- G. audit_log — Persistent Administrative Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT        NOT NULL DEFAULT 'System',
  detail      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- H. agent_configs — Global System RTP & House Config
CREATE TABLE IF NOT EXISTS public.agent_configs (
  id                    TEXT        PRIMARY KEY DEFAULT 'global_system_config',
  agent_id              UUID        REFERENCES public.profiles(id) ON DELETE CASCADE,
  rtp_percentage        NUMERIC     NOT NULL DEFAULT 96.0,
  target_win_percentage NUMERIC     NOT NULL DEFAULT 96.0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.agent_configs (id, rtp_percentage, target_win_percentage)
  VALUES ('global_system_config', 96.0, 96.0)
  ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: GLOBAL RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- A. check_and_update_login_session
CREATE OR REPLACE FUNCTION public.check_and_update_login_session(
  p_user_id      UUID,
  p_session_token TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_existing TEXT;
BEGIN
  SELECT session_token INTO v_existing FROM public.active_sessions WHERE user_id = p_user_id;
  IF v_existing IS NULL THEN
    INSERT INTO public.active_sessions (user_id, session_token, last_seen_at)
    VALUES (p_user_id, p_session_token, NOW());
    RETURN jsonb_build_object('allowed', true, 'status', 'session_created');
  ELSIF v_existing = p_session_token THEN
    UPDATE public.active_sessions SET last_seen_at = NOW() WHERE user_id = p_user_id;
    RETURN jsonb_build_object('allowed', true, 'status', 'session_valid');
  ELSE
    UPDATE public.active_sessions SET session_token = p_session_token, last_seen_at = NOW() WHERE user_id = p_user_id;
    RETURN jsonb_build_object('allowed', true, 'status', 'session_superseded');
  END IF;
END;
$$;

-- B. update_user_heartbeat (called every 15s-25s — checks is_active + session + returns live balance)
CREATE OR REPLACE FUNCTION public.update_user_heartbeat(
  p_user_id      UUID,
  p_session_token TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_active BOOLEAN;
  v_balance   NUMERIC;
  v_token     TEXT;
BEGIN
  SELECT is_active, balance INTO v_is_active, v_balance FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND OR NOT v_is_active THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'account_blocked');
  END IF;
  SELECT session_token INTO v_token FROM public.active_sessions WHERE user_id = p_user_id;
  IF v_token IS NULL OR v_token != p_session_token THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'session_displaced');
  END IF;
  UPDATE public.active_sessions SET last_seen_at = NOW() WHERE user_id = p_user_id;
  RETURN jsonb_build_object('allowed', true, 'balance', v_balance);
END;
$$;

-- C. clear_user_session (logout)
CREATE OR REPLACE FUNCTION public.clear_user_session(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0006'; END IF;
  IF auth.uid() != p_user_id AND public.get_my_role() != 'superadmin' THEN
    RAISE EXCEPTION 'Unauthorized' USING errcode = 'P0010';
  END IF;
  DELETE FROM public.active_sessions WHERE user_id = p_user_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: TRIPLE CHANCE RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- D. get_play_limits
CREATE OR REPLACE FUNCTION public.get_play_limits()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.play_limits;
BEGIN
  SELECT * INTO v_row FROM public.play_limits WHERE id = 'global' LIMIT 1;
  IF v_row IS NULL THEN
    RETURN jsonb_build_object(
      'single', jsonb_build_object('min', 2, 'max', 10000),
      'double', jsonb_build_object('min', 2, 'max', 1000),
      'triple', jsonb_build_object('min', 2, 'max', 100)
    );
  END IF;
  RETURN jsonb_build_object(
    'single', jsonb_build_object('min', v_row.single_min, 'max', v_row.single_max),
    'double', jsonb_build_object('min', v_row.double_min, 'max', v_row.double_max),
    'triple', jsonb_build_object('min', v_row.triple_min, 'max', v_row.triple_max)
  );
END;
$$;

-- E. calculate_round_rtp_outcome
-- Runs at T >= 70s elapsed (20s remaining). Calculates optimal digits matching
-- SuperAdmin's target RTP % from agent_configs.
CREATE OR REPLACE FUNCTION public.calculate_round_rtp_outcome(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round         public.triple_chance_rounds;
  v_rtp           NUMERIC := 96.0;
  v_total_stake   NUMERIC := 0;
  v_target_payout NUMERIC := 0;
  v_best_red      INT := 0;
  v_best_green    INT := 0;
  v_best_black    INT := 0;
  v_min_diff      NUMERIC := 999999999;
  v_hash          TEXT;
  v_r             INT;
  v_g             INT;
  v_b             INT;
  v_s_bet         NUMERIC;
  v_d_bet         NUMERIC;
  v_t_bet         NUMERIC;
  v_combo_payout  NUMERIC;
  v_diff          NUMERIC;
  v_bet_row       RECORD;
  -- Aggregated stakes per cell
  v_single_stakes NUMERIC[] := ARRAY[0,0,0,0,0,0,0,0,0,0];
  v_double_stakes NUMERIC[] := ARRAY_FILL(0::numeric, ARRAY[100]);
  v_triple_stakes NUMERIC[] := ARRAY_FILL(0::numeric, ARRAY[1000]);
  v_cell_k        TEXT;
  v_cell_v        NUMERIC;
  v_idx           INT;
BEGIN
  SELECT * INTO v_round FROM public.triple_chance_rounds WHERE id = p_round_id FOR UPDATE;
  IF v_round IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round not found');
  END IF;

  -- If digits already generated, return existing digits
  IF v_round.red IS NOT NULL AND v_round.green IS NOT NULL AND v_round.black IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'red', v_round.red,
      'green', v_round.green,
      'black', v_round.black
    );
  END IF;

  -- Fetch SuperAdmin target RTP %
  SELECT rtp_percentage INTO v_rtp FROM public.agent_configs WHERE id = 'global_system_config' LIMIT 1;
  IF v_rtp IS NULL THEN v_rtp := 96.0; END IF;

  -- Aggregate total stake and cell wagers across all bets placed in this round
  FOR v_bet_row IN SELECT single_bets, double_bets, triple_bets, total_stake FROM public.triple_chance_bets WHERE round_id = p_round_id LOOP
    v_total_stake := v_total_stake + COALESCE(v_bet_row.total_stake, 0);

    -- Single bets aggregation
    FOR v_cell_k, v_cell_v IN SELECT key, value::numeric FROM jsonb_each_text(v_bet_row.single_bets) LOOP
      v_idx := v_cell_k::INT;
      IF v_idx >= 0 AND v_idx <= 9 THEN
        v_single_stakes[v_idx + 1] := v_single_stakes[v_idx + 1] + v_cell_v;
      END IF;
    END LOOP;

    -- Double bets aggregation
    FOR v_cell_k, v_cell_v IN SELECT key, value::numeric FROM jsonb_each_text(v_bet_row.double_bets) LOOP
      v_idx := v_cell_k::INT;
      IF v_idx >= 0 AND v_idx <= 99 THEN
        v_double_stakes[v_idx + 1] := v_double_stakes[v_idx + 1] + v_cell_v;
      END IF;
    END LOOP;

    -- Triple bets aggregation
    FOR v_cell_k, v_cell_v IN SELECT key, value::numeric FROM jsonb_each_text(v_bet_row.triple_bets) LOOP
      v_idx := v_cell_k::INT;
      IF v_idx >= 0 AND v_idx <= 999 THEN
        v_triple_stakes[v_idx + 1] := v_triple_stakes[v_idx + 1] + v_cell_v;
      END IF;
    END LOOP;
  END LOOP;

  IF v_total_stake > 0 THEN
    -- Target payout for this round based on configured RTP
    v_target_payout := v_total_stake * (v_rtp / 100.0);

    -- Scan all 1,000 combinations (r=0..9, g=0..9, b=0..9)
    FOR v_r IN 0..9 LOOP
      FOR v_g IN 0..9 LOOP
        FOR v_b IN 0..9 LOOP
          v_s_bet := v_single_stakes[v_b + 1];
          v_d_bet := v_double_stakes[(v_g * 10 + v_b) + 1];
          v_t_bet := v_triple_stakes[(v_r * 100 + v_g * 10 + v_b) + 1];

          v_combo_payout := (v_s_bet * 9.0) + (v_d_bet * 90.0) + (v_t_bet * 900.0);
          v_diff := ABS(v_combo_payout - v_target_payout);

          IF v_diff < v_min_diff THEN
            v_min_diff   := v_diff;
            v_best_red   := v_r;
            v_best_green := v_g;
            v_best_black := v_b;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  ELSE
    -- If zero bets placed, generate via MD5 seed hash for 100% fair random outcome
    v_hash       := md5('bsg_tc_seed_' || v_round.round_number::TEXT);
    v_best_red   := (ABS(('x' || SUBSTR(v_hash,  1, 8))::BIT(32)::INT) % 10);
    v_best_green := (ABS(('x' || SUBSTR(v_hash,  9, 8))::BIT(32)::INT) % 10);
    v_best_black := (ABS(('x' || SUBSTR(v_hash, 17, 8))::BIT(32)::INT) % 10);
  END IF;

  -- Lock calculated digits into database
  UPDATE public.triple_chance_rounds
  SET red = v_best_red, green = v_best_green, black = v_best_black
  WHERE id = p_round_id;

  RETURN jsonb_build_object(
    'success', true,
    'red', v_best_red,
    'green', v_best_green,
    'black', v_best_black
  );
END;
$$;

-- F. get_current_round (103-second cycle — must match Flutter client)
CREATE OR REPLACE FUNCTION public.get_current_round()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle       CONSTANT INT := 103;  -- 90s betting + 13s spin
  v_bet_window  CONSTANT INT := 90;
  v_now_epoch   BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_round_num   BIGINT := v_now_epoch / v_cycle;
  v_secs_into   INT    := (v_now_epoch % v_cycle)::INT;
  v_secs_left   INT    := v_cycle - v_secs_into;
  v_status      TEXT;
  v_round       public.triple_chance_rounds;
BEGIN
  v_status := CASE WHEN v_secs_into < v_bet_window THEN 'betting' ELSE 'spinning' END;

  SELECT * INTO v_round FROM public.triple_chance_rounds WHERE round_number = v_round_num;

  IF v_round IS NULL THEN
    INSERT INTO public.triple_chance_rounds
      (round_number, scheduled_at, status)
    VALUES
      (v_round_num, TO_TIMESTAMP((v_round_num + 1) * v_cycle), v_status)
    ON CONFLICT (round_number) DO NOTHING
    RETURNING * INTO v_round;

    IF v_round IS NULL THEN
      SELECT * INTO v_round FROM public.triple_chance_rounds WHERE round_number = v_round_num;
    END IF;
  END IF;

  -- Trigger RTP Calculation at T >= 70s (20s remaining) if digits not yet calculated
  IF v_secs_into >= 70 AND v_round.red IS NULL THEN
    PERFORM public.calculate_round_rtp_outcome(v_round.id);
    SELECT * INTO v_round FROM public.triple_chance_rounds WHERE round_number = v_round_num;
  END IF;

  -- Trigger Server-Side Auto-Settlement at T >= 90s (spin start)
  IF v_secs_into >= 90 THEN
    PERFORM public.resolve_round_payouts(v_round.id);
    SELECT * INTO v_round FROM public.triple_chance_rounds WHERE round_number = v_round_num;
  END IF;

  -- Update status if spinning/complete
  IF v_round.status != v_status THEN
    UPDATE public.triple_chance_rounds SET status = v_status WHERE id = v_round.id;
    v_round.status := v_status;
  END IF;

  RETURN jsonb_build_object(
    'round_id',          v_round.id,
    'round_number',      v_round.round_number,
    'status',            v_status,
    'scheduled_at',      v_round.scheduled_at,
    'seconds_remaining', v_secs_left,
    'red',               v_round.red,
    'green',             v_round.green,
    'black',             v_round.black
  );
END;
$$;

-- G. resolve_round_payouts (Server-Side Auto-Settlement at T=90s spin start)
CREATE OR REPLACE FUNCTION public.resolve_round_payouts(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round         public.triple_chance_rounds;
  v_bet_row       RECORD;
  v_s_key         TEXT;
  v_d_key         TEXT;
  v_t_key         TEXT;
  v_s_bet         NUMERIC;
  v_d_bet         NUMERIC;
  v_t_bet         NUMERIC;
  v_s_win         NUMERIC;
  v_d_win         NUMERIC;
  v_t_win         NUMERIC;
  v_total_win     NUMERIC;
  v_agent_id      UUID;
  v_settled_count INT := 0;
BEGIN
  SELECT * INTO v_round FROM public.triple_chance_rounds WHERE id = p_round_id FOR UPDATE;
  IF v_round IS NULL OR v_round.red IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round or digits missing');
  END IF;

  v_s_key := v_round.black::TEXT;
  v_d_key := v_round.green::TEXT || v_round.black::TEXT;
  v_t_key := v_round.red::TEXT || v_round.green::TEXT || v_round.black::TEXT;

  FOR v_bet_row IN SELECT * FROM public.triple_chance_bets WHERE round_id = p_round_id AND is_resolved = false FOR UPDATE LOOP
    v_s_bet := COALESCE((v_bet_row.single_bets ->> v_s_key)::NUMERIC, COALESCE((v_bet_row.single_bets ->> (v_s_key::INT)::TEXT)::NUMERIC, 0));
    v_d_bet := COALESCE(
      (v_bet_row.double_bets ->> v_d_key)::NUMERIC,
      COALESCE((v_bet_row.double_bets ->> LPAD(v_d_key, 2, '0'))::NUMERIC,
      COALESCE((v_bet_row.double_bets ->> (v_d_key::INT)::TEXT)::NUMERIC, 0))
    );
    v_t_bet := COALESCE(
      (v_bet_row.triple_bets ->> v_t_key)::NUMERIC,
      COALESCE((v_bet_row.triple_bets ->> LPAD(v_t_key, 3, '0'))::NUMERIC,
      COALESCE((v_bet_row.triple_bets ->> (v_t_key::INT)::TEXT)::NUMERIC, 0))
    );

    v_s_win     := v_s_bet * 9.0;
    v_d_win     := v_d_bet * 90.0;
    v_t_win     := v_t_bet * 900.0;
    v_total_win := v_s_win + v_d_win + v_t_win;

    SELECT agent_id INTO v_agent_id FROM public.profiles WHERE id = v_bet_row.user_id;

    UPDATE public.triple_chance_bets SET
      single_win  = v_s_win,
      double_win  = v_d_win,
      triple_win  = v_t_win,
      win_amount  = v_total_win,
      is_resolved = true
    WHERE id = v_bet_row.id;

    IF v_total_win > 0 THEN
      UPDATE public.profiles
        SET balance = balance + v_total_win,
            ledger_version = ledger_version + 1,
            updated_at = NOW()
        WHERE id = v_bet_row.user_id;

      INSERT INTO public.transactions (user_id, agent_id, game_name, type, amount, balance_after)
        VALUES (v_bet_row.user_id, v_agent_id, 'triple_chance', 'win_payout', v_total_win,
                (SELECT balance FROM public.profiles WHERE id = v_bet_row.user_id));
    END IF;

    v_settled_count := v_settled_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'settled_count', v_settled_count);
END;
$$;

-- G. get_recent_rounds (history grid — last N completed rounds)
CREATE OR REPLACE FUNCTION public.get_recent_rounds(p_limit INT DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle       CONSTANT INT := 103;
  v_now_epoch   BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_current     BIGINT := v_now_epoch / v_cycle;
  v_results     jsonb  := '[]'::jsonb;
  v_r_num       BIGINT;
  v_db_round    public.triple_chance_rounds;
  v_hash        TEXT;
  v_red INT; v_green INT; v_black INT;
  i             INT;
BEGIN
  FOR i IN 1..LEAST(p_limit, 50) LOOP
    v_r_num := v_current - i;
    SELECT * INTO v_db_round FROM public.triple_chance_rounds WHERE round_number = v_r_num;
    IF v_db_round IS NOT NULL AND v_db_round.red IS NOT NULL THEN
      v_red   := v_db_round.red;
      v_green := v_db_round.green;
      v_black := v_db_round.black;
    ELSE
      v_hash  := md5('bsg_tc_seed_' || v_r_num::TEXT);
      v_red   := (ABS(('x' || SUBSTR(v_hash,  1, 8))::BIT(32)::INT) % 10);
      v_green := (ABS(('x' || SUBSTR(v_hash,  9, 8))::BIT(32)::INT) % 10);
      v_black := (ABS(('x' || SUBSTR(v_hash, 17, 8))::BIT(32)::INT) % 10);
    END IF;

    v_results := v_results || jsonb_build_object(
      'id',           'round_' || v_r_num::TEXT,
      'round_number', v_r_num,
      'red',          v_red,
      'green',        v_green,
      'black',        v_black,
      'scheduled_at', TO_TIMESTAMP((v_r_num + 1) * v_cycle)
    );
  END LOOP;
  RETURN v_results;
END;
$$;

-- G. submit_round_bet (atomic bet submission — deducts balance, writes transaction)
CREATE OR REPLACE FUNCTION public.submit_round_bet(
  p_round_id    UUID,
  p_single_bets JSONB,
  p_double_bets JSONB,
  p_triple_bets JSONB,
  p_total_stake NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id        UUID    := auth.uid();
  v_balance        NUMERIC;
  v_agent_id       UUID;
  v_round          public.triple_chance_rounds;
  v_limits         public.play_limits;
  v_existing_stake NUMERIC := 0;
  v_computed_stake NUMERIC := 0;
  v_delta_stake    NUMERIC;
  v_cell_key       TEXT;
  v_cell_val       NUMERIC;
  v_cycle          CONSTANT INT := 103;
  v_now_epoch      BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_secs_into      INT := (v_now_epoch % v_cycle)::INT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0006'; END IF;

  SELECT * INTO v_round FROM public.triple_chance_rounds WHERE id = p_round_id;
  IF v_round IS NULL THEN RAISE EXCEPTION 'Round not found' USING errcode = 'P0002'; END IF;
  IF v_round.status != 'betting' OR v_secs_into > 85 THEN RAISE EXCEPTION 'Betting window closed' USING errcode = 'P0003'; END IF;

  SELECT * INTO v_limits FROM public.play_limits WHERE id = 'global' LIMIT 1;

  IF v_limits IS NOT NULL THEN
    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_single_bets) LOOP
      IF v_cell_val < v_limits.single_min THEN RAISE EXCEPTION 'Below min' USING errcode = 'P0007'; END IF;
      IF v_cell_val > v_limits.single_max THEN RAISE EXCEPTION 'Exceeds max' USING errcode = 'P0008'; END IF;
      v_computed_stake := v_computed_stake + v_cell_val;
    END LOOP;
    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_double_bets) LOOP
      IF v_cell_val < v_limits.double_min THEN RAISE EXCEPTION 'Below min' USING errcode = 'P0007'; END IF;
      IF v_cell_val > v_limits.double_max THEN RAISE EXCEPTION 'Exceeds max' USING errcode = 'P0008'; END IF;
      v_computed_stake := v_computed_stake + v_cell_val;
    END LOOP;
    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_triple_bets) LOOP
      IF v_cell_val < v_limits.triple_min THEN RAISE EXCEPTION 'Below min' USING errcode = 'P0007'; END IF;
      IF v_cell_val > v_limits.triple_max THEN RAISE EXCEPTION 'Exceeds max' USING errcode = 'P0008'; END IF;
      v_computed_stake := v_computed_stake + v_cell_val;
    END LOOP;
  ELSE
    -- If no limits configured, still compute stake from JSONB maps
    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_single_bets) LOOP v_computed_stake := v_computed_stake + v_cell_val; END LOOP;
    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_double_bets) LOOP v_computed_stake := v_computed_stake + v_cell_val; END LOOP;
    FOR v_cell_key, v_cell_val IN SELECT key, value::numeric FROM jsonb_each_text(p_triple_bets) LOOP v_computed_stake := v_computed_stake + v_cell_val; END LOOP;
  END IF;

  SELECT balance, agent_id INTO v_balance, v_agent_id
    FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  IF v_balance IS NULL THEN RAISE EXCEPTION 'Player not found' USING errcode = 'P0004'; END IF;

  SELECT total_stake INTO v_existing_stake
    FROM public.triple_chance_bets WHERE round_id = p_round_id AND user_id = v_user_id;
  v_existing_stake := COALESCE(v_existing_stake, 0);
  v_delta_stake    := v_computed_stake - v_existing_stake;

  IF v_delta_stake > 0 AND v_balance < v_delta_stake THEN
    RAISE EXCEPTION 'INSUFFICIENT_COINS' USING errcode = 'P0001';
  END IF;

  IF v_delta_stake != 0 THEN
    UPDATE public.profiles
      SET balance = balance - v_delta_stake,
          ledger_version = ledger_version + 1,
          updated_at = NOW()
      WHERE id = v_user_id;

    INSERT INTO public.transactions (user_id, agent_id, game_name, type, amount, balance_after)
      VALUES (v_user_id, v_agent_id, 'triple_chance', 'bet_stake', -v_delta_stake,
              (SELECT balance FROM public.profiles WHERE id = v_user_id));
  END IF;

  INSERT INTO public.triple_chance_bets (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
    VALUES (p_round_id, v_user_id, p_single_bets, p_double_bets, p_triple_bets, v_computed_stake)
    ON CONFLICT (round_id, user_id) DO UPDATE SET
      single_bets = EXCLUDED.single_bets,
      double_bets = EXCLUDED.double_bets,
      triple_bets = EXCLUDED.triple_bets,
      total_stake = v_computed_stake;

  RETURN jsonb_build_object(
    'success',        true,
    'balance_after',  (SELECT balance FROM public.profiles WHERE id = v_user_id),
    'ledger_version', (SELECT ledger_version FROM public.profiles WHERE id = v_user_id)
  );
END;
$$;

-- H. get_my_round_result (self-resolving: calculates win + credits balance on first call)
CREATE OR REPLACE FUNCTION public.get_my_round_result(p_round_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id    UUID    := auth.uid();
  v_bet        public.triple_chance_bets;
  v_round      public.triple_chance_rounds;
  v_balance    NUMERIC;
  v_s_win      NUMERIC := 0;
  v_d_win      NUMERIC := 0;
  v_t_win      NUMERIC := 0;
  v_total_win  NUMERIC := 0;
  v_s_key      TEXT;
  v_d_key      TEXT;
  v_t_key      TEXT;
  v_s_bet      NUMERIC;
  v_d_bet      NUMERIC;
  v_t_bet      NUMERIC;
  v_agent_id   UUID;
  v_round_uuid UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0006'; END IF;

  IF p_round_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_round_uuid := p_round_id::UUID;
  ELSE
    SELECT id INTO v_round_uuid FROM public.triple_chance_rounds
      WHERE round_number = (REGEXP_REPLACE(p_round_id, '[^0-9]', '', 'g'))::BIGINT
      LIMIT 1;
  END IF;

  IF v_round_uuid IS NULL THEN
    SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user_id;
    RETURN jsonb_build_object('placed_bet', false, 'win_amount', 0, 'total_stake', 0, 'balance', v_balance);
  END IF;

  SELECT * INTO v_bet FROM public.triple_chance_bets
    WHERE round_id = v_round_uuid AND user_id = v_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user_id;
    RETURN jsonb_build_object('placed_bet', false, 'win_amount', 0, 'total_stake', 0, 'balance', v_balance);
  END IF;

  IF v_bet.is_resolved THEN
    SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user_id;
    RETURN jsonb_build_object(
      'placed_bet',  true,
      'win_amount',  v_bet.win_amount,
      'single_win',  v_bet.single_win,
      'double_win',  v_bet.double_win,
      'triple_win',  v_bet.triple_win,
      'total_stake', v_bet.total_stake,
      'is_resolved', true,
      'balance',     v_balance
    );
  END IF;

  SELECT * INTO v_round FROM public.triple_chance_rounds WHERE id = v_round_uuid;
  IF v_round IS NULL OR v_round.red IS NULL THEN
    SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user_id;
    RETURN jsonb_build_object('placed_bet', true, 'win_amount', 0, 'is_resolved', false, 'balance', v_balance);
  END IF;

  v_s_key := v_round.black::TEXT;
  v_d_key := v_round.green::TEXT || v_round.black::TEXT;
  v_t_key := v_round.red::TEXT || v_round.green::TEXT || v_round.black::TEXT;

  v_s_bet := COALESCE((v_bet.single_bets ->> v_s_key)::NUMERIC, COALESCE((v_bet.single_bets ->> (v_s_key::INT)::TEXT)::NUMERIC, 0));
  
  v_d_bet := COALESCE(
    (v_bet.double_bets ->> v_d_key)::NUMERIC,
    COALESCE((v_bet.double_bets ->> LPAD(v_d_key, 2, '0'))::NUMERIC,
    COALESCE((v_bet.double_bets ->> (v_d_key::INT)::TEXT)::NUMERIC, 0))
  );

  v_t_bet := COALESCE(
    (v_bet.triple_bets ->> v_t_key)::NUMERIC,
    COALESCE((v_bet.triple_bets ->> LPAD(v_t_key, 3, '0'))::NUMERIC,
    COALESCE((v_bet.triple_bets ->> (v_t_key::INT)::TEXT)::NUMERIC, 0))
  );

  v_s_win     := v_s_bet * 9;
  v_d_win     := v_d_bet * 90;
  v_t_win     := v_t_bet * 900;
  v_total_win := v_s_win + v_d_win + v_t_win;

  SELECT agent_id INTO v_agent_id FROM public.profiles WHERE id = v_user_id;

  UPDATE public.triple_chance_bets SET
    single_win  = v_s_win,
    double_win  = v_d_win,
    triple_win  = v_t_win,
    win_amount  = v_total_win,
    is_resolved = true
  WHERE id = v_bet.id;

  UPDATE public.triple_chance_rounds SET
    status = 'complete'
  WHERE id = v_round_uuid AND status != 'complete';

  IF v_total_win > 0 THEN
    UPDATE public.profiles
      SET balance = balance + v_total_win, updated_at = NOW()
      WHERE id = v_user_id;

    INSERT INTO public.transactions (user_id, agent_id, game_name, type, amount, balance_after)
      VALUES (v_user_id, v_agent_id, 'triple_chance', 'win_payout', v_total_win,
              (SELECT balance FROM public.profiles WHERE id = v_user_id));
  END IF;

  SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'placed_bet',  true,
    'win_amount',  v_total_win,
    'single_win',  v_s_win,
    'double_win',  v_d_win,
    'triple_win',  v_t_win,
    'total_stake', v_bet.total_stake,
    'is_resolved', true,
    'balance',     v_balance
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triple_chance_rounds  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triple_chance_bets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.play_limits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_configs         ENABLE ROW LEVEL SECURITY;

-- profiles: scoped selection via profiles_agent_select policy below (Step 9)
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

-- active_sessions: own row only
DROP POLICY IF EXISTS "sessions_select" ON public.active_sessions;
CREATE POLICY "sessions_select" ON public.active_sessions FOR SELECT USING (user_id = auth.uid());

-- transactions: own rows only
DROP POLICY IF EXISTS "transactions_select" ON public.transactions;
CREATE POLICY "transactions_select" ON public.transactions FOR SELECT USING (user_id = auth.uid());

-- triple_chance_rounds: all authenticated players can read
DROP POLICY IF EXISTS "tc_rounds_select" ON public.triple_chance_rounds;
CREATE POLICY "tc_rounds_select" ON public.triple_chance_rounds FOR SELECT USING (true);

-- triple_chance_bets: own rows only
DROP POLICY IF EXISTS "tc_bets_select" ON public.triple_chance_bets;
CREATE POLICY "tc_bets_select" ON public.triple_chance_bets FOR SELECT USING (user_id = auth.uid());

-- play_limits: all authenticated players can read
DROP POLICY IF EXISTS "play_limits_select" ON public.play_limits;
CREATE POLICY "play_limits_select" ON public.play_limits FOR SELECT USING (true);

-- audit_log: superadmin read-only
DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log FOR SELECT USING (public.get_my_role() = 'superadmin');

-- agent_configs: agents and superadmins can read
DROP POLICY IF EXISTS "agent_configs_select" ON public.agent_configs;
CREATE POLICY "agent_configs_select" ON public.agent_configs FOR SELECT USING (public.get_my_role() IN ('agent', 'superadmin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: AUTO-CREATE PROFILE ON AUTH SIGNUP
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, role, balance, is_active, agent_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    CASE
      WHEN NEW.raw_user_meta_data->>'role' IN ('agent', 'player') THEN NEW.raw_user_meta_data->>'role'
      ELSE 'player'
    END,
    0, -- Balance must start at 0; funded via agent/admin RPCs only
    TRUE,
    -- agent_id is passed in metadata when agent creates player from web dashboard
    CASE
      WHEN NEW.raw_user_meta_data->>'agent_id' IS NOT NULL
      THEN (NEW.raw_user_meta_data->>'agent_id')::uuid
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8: SYNC EXISTING AUTH USERS (if any exist already)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, username, role, balance, is_active)
SELECT
  id,
  COALESCE(raw_user_meta_data->>'username', SPLIT_PART(email, '@', 1)),
  COALESCE(raw_user_meta_data->>'role', 'player'),
  COALESCE((raw_user_meta_data->>'balance')::numeric, 0),
  TRUE
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 9: AGENT-SCOPED RLS POLICIES
-- Agents can only see and manage players they created (their own panel).
-- Superadmin can see everything.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper function: get calling user's role
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid(); $$;

-- Helper function: get calling user's agent_id (for agent checking their own players)
CREATE OR REPLACE FUNCTION public.get_my_agent_id()
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT id FROM public.profiles WHERE id = auth.uid() AND role = 'agent'; $$;

-- profiles: agents can SELECT only their own players; superadmin sees all
DROP POLICY IF EXISTS "profiles_agent_select" ON public.profiles;
CREATE POLICY "profiles_agent_select" ON public.profiles
  FOR SELECT USING (
    -- Own row always visible
    id = auth.uid()
    OR
    -- Superadmin sees all
    public.get_my_role() = 'superadmin'
    OR
    -- Agent sees only players they created
    (public.get_my_role() = 'agent' AND agent_id = auth.uid())
  );

-- transactions: agents see only their own players' transactions
DROP POLICY IF EXISTS "transactions_agent_select" ON public.transactions;
CREATE POLICY "transactions_agent_select" ON public.transactions
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() = 'agent'
      AND user_id IN (
        SELECT id FROM public.profiles WHERE agent_id = auth.uid()
      )
    )
  );

-- triple_chance_bets: agents see only their own players' bets
DROP POLICY IF EXISTS "tc_bets_agent_select" ON public.triple_chance_bets;
CREATE POLICY "tc_bets_agent_select" ON public.triple_chance_bets
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() = 'agent'
      AND user_id IN (
        SELECT id FROM public.profiles WHERE agent_id = auth.uid()
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 10: AGENT RPCs FOR WEB DASHBOARD
-- ─────────────────────────────────────────────────────────────────────────────

-- agent_topup_player: Agent tops up a player's coins from web dashboard
-- Web dashboard calls this after funding. Writes transaction + updates balance.
CREATE OR REPLACE FUNCTION public.agent_topup_player(
  p_player_id UUID,
  p_amount    NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent_id   UUID    := auth.uid();
  v_agent_role TEXT;
  v_player     public.profiles;
  v_new_balance NUMERIC;
BEGIN
  -- Only agents and superadmins can top up
  SELECT role INTO v_agent_role FROM public.profiles WHERE id = v_agent_id;
  IF v_agent_role NOT IN ('agent', 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized' USING errcode = 'P0010';
  END IF;

  -- Agent can only top up their own players
  SELECT * INTO v_player FROM public.profiles
    WHERE id = p_player_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found' USING errcode = 'P0004';
  END IF;

  IF v_agent_role = 'agent' AND v_player.agent_id != v_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: not your player' USING errcode = 'P0011';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive' USING errcode = 'P0012';
  END IF;

  UPDATE public.profiles
    SET balance = balance + p_amount, updated_at = NOW()
    WHERE id = p_player_id;

  SELECT balance INTO v_new_balance FROM public.profiles WHERE id = p_player_id;

  INSERT INTO public.transactions (user_id, agent_id, game_name, type, amount, balance_after)
    VALUES (p_player_id, v_agent_id, 'system', 'agent_topup', p_amount, v_new_balance);

  RETURN jsonb_build_object(
    'success',       true,
    'player_id',     p_player_id,
    'amount_added',  p_amount,
    'balance_after', v_new_balance
  );
END;
$$;

-- agent_deduct_player: Agent deducts coins from a player (e.g. correction)
CREATE OR REPLACE FUNCTION public.agent_deduct_player(
  p_player_id UUID,
  p_amount    NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent_id    UUID := auth.uid();
  v_agent_role  TEXT;
  v_player      public.profiles;
  v_new_balance NUMERIC;
BEGIN
  SELECT role INTO v_agent_role FROM public.profiles WHERE id = v_agent_id;
  IF v_agent_role NOT IN ('agent', 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized' USING errcode = 'P0010';
  END IF;

  SELECT * INTO v_player FROM public.profiles
    WHERE id = p_player_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Player not found' USING errcode = 'P0004'; END IF;

  IF v_agent_role = 'agent' AND v_player.agent_id != v_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: not your player' USING errcode = 'P0011';
  END IF;

  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive' USING errcode = 'P0012'; END IF;
  IF v_player.balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance' USING errcode = 'P0001'; END IF;

  UPDATE public.profiles
    SET balance = balance - p_amount, updated_at = NOW()
    WHERE id = p_player_id;

  SELECT balance INTO v_new_balance FROM public.profiles WHERE id = p_player_id;

  INSERT INTO public.transactions (user_id, agent_id, game_name, type, amount, balance_after)
    VALUES (p_player_id, v_agent_id, 'system', 'agent_deduct', -p_amount, v_new_balance);

  RETURN jsonb_build_object(
    'success',        true,
    'player_id',      p_player_id,
    'amount_deducted', p_amount,
    'balance_after',  v_new_balance
  );
END;
$$;

-- get_my_players: Agent fetches their own player list for web dashboard panel
CREATE OR REPLACE FUNCTION public.get_my_players()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent_id UUID := auth.uid();
  v_role     TEXT;
  v_result   jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_agent_id;

  IF v_role = 'superadmin' THEN
    -- Superadmin gets all players
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', id, 'username', username, 'balance', balance,
        'is_active', is_active, 'agent_id', agent_id, 'created_at', created_at
      )
    ) INTO v_result
    FROM public.profiles WHERE role = 'player';
  ELSIF v_role = 'agent' THEN
    -- Agent gets only their own players
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', id, 'username', username, 'balance', balance,
        'is_active', is_active, 'agent_id', agent_id, 'created_at', created_at
      )
    ) INTO v_result
    FROM public.profiles WHERE role = 'player' AND agent_id = v_agent_id;
  ELSE
    RAISE EXCEPTION 'Unauthorized' USING errcode = 'P0010';
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- toggle_player_active: Agent blocks/unblocks a player
CREATE OR REPLACE FUNCTION public.toggle_player_active(
  p_player_id UUID,
  p_is_active BOOLEAN
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent_id  UUID := auth.uid();
  v_agent_role TEXT;
  v_player    public.profiles;
BEGIN
  SELECT role INTO v_agent_role FROM public.profiles WHERE id = v_agent_id;
  IF v_agent_role NOT IN ('agent', 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized' USING errcode = 'P0010';
  END IF;

  SELECT * INTO v_player FROM public.profiles WHERE id = p_player_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player not found' USING errcode = 'P0004'; END IF;

  IF v_agent_role = 'agent' AND v_player.agent_id != v_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: not your player' USING errcode = 'P0011';
  END IF;

  UPDATE public.profiles SET is_active = p_is_active, updated_at = NOW()
    WHERE id = p_player_id;

  RETURN jsonb_build_object('success', true, 'is_active', p_is_active);
END;
$$;

-- transfer_coins_agent_to_player: Superadmin/Agent transfers coins to assigned player
CREATE OR REPLACE FUNCTION public.transfer_coins_agent_to_player(
  p_agent_id  UUID,
  p_player_id UUID,
  p_amount    NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID := COALESCE(auth.uid(), p_agent_id);
  v_caller_role TEXT;
  v_agent_bal   NUMERIC;
  v_player_bal  NUMERIC;
  v_is_service  BOOLEAN := (current_setting('request.jwt.claim.role', true) = 'service_role');
BEGIN
  IF v_caller_id IS NULL AND NOT v_is_service THEN RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0006'; END IF;
  
  IF v_is_service THEN
    v_caller_role := 'superadmin';
  ELSE
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  END IF;

  IF v_caller_role NOT IN ('agent', 'superadmin') THEN RAISE EXCEPTION 'Unauthorized' USING errcode = 'P0010'; END IF;

  IF NOT v_is_service AND v_caller_role = 'agent' AND v_caller_id != p_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: can only transfer from own agent account' USING errcode = 'P0011';
  END IF;
  IF NOT v_is_service AND v_caller_role = 'agent' AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_player_id AND agent_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: not your player' USING errcode = 'P0011';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING errcode = 'P0001';
  END IF;

  SELECT balance INTO v_agent_bal FROM public.profiles WHERE id = p_agent_id FOR UPDATE;
  IF v_agent_bal IS NULL OR v_agent_bal < p_amount THEN
    RAISE EXCEPTION 'Insufficient agent balance' USING errcode = 'P0002';
  END IF;

  UPDATE public.profiles SET balance = balance - p_amount, updated_at = NOW() WHERE id = p_agent_id;
  UPDATE public.profiles SET balance = balance + p_amount, updated_at = NOW() WHERE id = p_player_id;

  SELECT balance INTO v_player_bal FROM public.profiles WHERE id = p_player_id;

  INSERT INTO public.transactions (user_id, agent_id, game_name, type, amount, balance_after)
    VALUES (p_player_id, p_agent_id, 'system', 'agent_topup', p_amount, v_player_bal);

  RETURN jsonb_build_object(
    'success', true,
    'new_player_balance', v_player_bal,
    'new_agent_balance', (v_agent_bal - p_amount)
  );
END;
$$;

-- withdraw_coins_player_to_agent: Withdraws coins from player back to agent
CREATE OR REPLACE FUNCTION public.withdraw_coins_player_to_agent(
  p_agent_id  UUID,
  p_player_id UUID,
  p_amount    NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID := COALESCE(auth.uid(), p_agent_id);
  v_caller_role TEXT;
  v_agent_bal   NUMERIC;
  v_player_bal  NUMERIC;
  v_is_service  BOOLEAN := (current_setting('request.jwt.claim.role', true) = 'service_role');
BEGIN
  IF v_caller_id IS NULL AND NOT v_is_service THEN RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0006'; END IF;

  IF v_is_service THEN
    v_caller_role := 'superadmin';
  ELSE
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  END IF;

  IF v_caller_role NOT IN ('agent', 'superadmin') THEN RAISE EXCEPTION 'Unauthorized' USING errcode = 'P0010'; END IF;

  IF NOT v_is_service AND v_caller_role = 'agent' AND v_caller_id != p_agent_id THEN
    RAISE EXCEPTION 'Unauthorized: can only withdraw to own agent account' USING errcode = 'P0011';
  END IF;
  IF NOT v_is_service AND v_caller_role = 'agent' AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_player_id AND agent_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: not your player' USING errcode = 'P0011';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING errcode = 'P0001';
  END IF;

  SELECT balance INTO v_player_bal FROM public.profiles WHERE id = p_player_id FOR UPDATE;
  IF v_player_bal IS NULL OR v_player_bal < p_amount THEN
    RAISE EXCEPTION 'Insufficient player balance' USING errcode = 'P0002';
  END IF;

  UPDATE public.profiles SET balance = balance - p_amount, updated_at = NOW() WHERE id = p_player_id;
  UPDATE public.profiles SET balance = balance + p_amount, updated_at = NOW() WHERE id = p_agent_id;

  SELECT balance INTO v_agent_bal FROM public.profiles WHERE id = p_agent_id;
  SELECT balance INTO v_player_bal FROM public.profiles WHERE id = p_player_id;

  INSERT INTO public.transactions (user_id, agent_id, game_name, type, amount, balance_after)
    VALUES (p_player_id, p_agent_id, 'system', 'agent_deduct', -p_amount, v_player_bal);

  RETURN jsonb_build_object(
    'success', true,
    'new_player_balance', v_player_bal,
    'new_agent_balance', v_agent_bal
  );
END;
$$;

-- issue_agent_coins: Superadmin issues coins directly to an agent
CREATE OR REPLACE FUNCTION public.issue_agent_coins(
  p_admin_id UUID DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL,
  p_amount   NUMERIC DEFAULT 0,
  p_type     TEXT DEFAULT 'deposit'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID := COALESCE(auth.uid(), p_admin_id);
  v_caller_role TEXT;
  v_delta       NUMERIC;
  v_new_bal     NUMERIC;
  v_username    TEXT;
  v_is_service  BOOLEAN := (current_setting('request.jwt.claim.role', true) = 'service_role');
BEGIN
  IF v_caller_id IS NULL AND NOT v_is_service THEN RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0006'; END IF;

  IF v_is_service THEN
    v_caller_role := 'superadmin';
  ELSE
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  END IF;

  IF v_caller_role != 'superadmin' THEN RAISE EXCEPTION 'Unauthorized: superadmin only' USING errcode = 'P0010'; END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive' USING errcode = 'P0001';
  END IF;

  v_delta := CASE WHEN p_type = 'withdraw' THEN -p_amount ELSE p_amount END;

  SELECT username, balance INTO v_username, v_new_bal FROM public.profiles WHERE id = p_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent profile not found' USING errcode = 'P0004';
  END IF;

  IF (v_new_bal + v_delta) < 0 THEN
    RAISE EXCEPTION 'Insufficient agent balance to withdraw' USING errcode = 'P0002';
  END IF;

  UPDATE public.profiles SET balance = balance + v_delta, updated_at = NOW() WHERE id = p_agent_id;
  SELECT balance INTO v_new_bal FROM public.profiles WHERE id = p_agent_id;

  INSERT INTO public.transactions (user_id, agent_id, game_name, type, amount, balance_after)
    VALUES (p_agent_id, p_admin_id, 'system', 'admin_adjustment', v_delta, v_new_bal);

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_bal
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 11: RELOAD SCHEMA CACHE
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


