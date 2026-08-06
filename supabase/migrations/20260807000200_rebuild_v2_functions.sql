-- #############################################################################
-- BSG v2 — FUNCTIONS / RPC SURFACE
-- Migration: 20260807000200_rebuild_v2_functions.sql
-- #############################################################################
--
-- RULES APPLIED THROUGHOUT
--   * Exactly ONE signature per name. v1 had competing uuid/text overloads of
--     submit_round_bet, which risks PostgREST "could not choose the best
--     candidate function" (finding M-8).
--   * Identity always comes from auth.uid() and public.profiles. Holding the
--     service-role key never confers privilege (finding C-6 / A-5).
--   * Every balance change goes through apply_coin_movement(), which updates
--     the balance, bumps ledger_version and writes the ledger row in one
--     statement sequence. There is no other way to change coin_balance.
--   * Bet keys are validated to ONE canonical zero-padded form on write, so
--     settlement needs a single lookup instead of v1's padded/unpadded/int
--     triple-fallback (the source of several payout mismatches).
--   * Internal helpers are REVOKEd from anon/authenticated at the bottom.
-- #############################################################################

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — ACCOUNT PROVISIONING
-- ═════════════════════════════════════════════════════════════════════════════

-- Creates the profile row whenever an auth user is created.
-- Role is clamped to agent/player: a superadmin can never be minted through
-- signup, only seeded deliberately. (v1's trigger allowed the metadata role
-- through, and the dashboard separately auto-elevated anyone named 'admin'.)
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
  v_role     := COALESCE(NEW.raw_user_meta_data->>'role', 'player');
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
    v_agent_id := NULL;   -- agents report to the superadmin implicitly
  END IF;

  INSERT INTO public.profiles (id, username, email, full_name, role, agent_id, coin_balance)
  VALUES (
    NEW.id,
    v_username,
    lower(v_username) || '@bestsmartgame.com',   -- invariant 3
    NEW.raw_user_meta_data->>'full_name',
    v_role,
    v_agent_id,
    0                                            -- funded only via coin movements
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — THE SINGLE MONEY PATH
-- ═════════════════════════════════════════════════════════════════════════════

-- The ONLY way coin_balance ever changes. Locks the row, applies the delta,
-- bumps ledger_version, and writes the matching ledger entry. A negative
-- result raises rather than clamping, so an accounting error surfaces instead
-- of silently destroying coins.
CREATE OR REPLACE FUNCTION public.apply_coin_movement(
  p_user_id         UUID,
  p_counterparty_id UUID,
  p_kind            TEXT,
  p_amount          BIGINT,
  p_round_id        UUID DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'Coin movement must be non-zero' USING errcode = 'P0110';
  END IF;

  SELECT coin_balance INTO v_balance
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found' USING errcode = 'P0111';
  END IF;

  IF v_balance + p_amount < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_COINS' USING errcode = 'P0112';
  END IF;

  UPDATE public.profiles
     SET coin_balance   = coin_balance + p_amount,
         ledger_version = ledger_version + 1,
         updated_at     = NOW()
   WHERE id = p_user_id
   RETURNING coin_balance INTO v_balance;

  INSERT INTO public.coin_ledger
    (user_id, counterparty_id, kind, amount, balance_after, round_id)
  VALUES
    (p_user_id, p_counterparty_id, p_kind, p_amount, v_balance, p_round_id);

  RETURN v_balance;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — SESSIONS  (Q6: a second login is REFUSED)
-- ═════════════════════════════════════════════════════════════════════════════

-- v1 always returned allowed=true and silently displaced the first device, so
-- the "already logged in" message could never appear (finding C-1). v2 refuses
-- while the existing session is alive, and takes over only once it has gone
-- quiet for game_config.session_grace_sec — so a crashed client cannot lock the
-- account out permanently.
--
-- v1 also took p_user_id as a parameter with no auth check, letting anyone with
-- the anon key displace any user's session (finding C-2). v2 uses auth.uid().
CREATE OR REPLACE FUNCTION public.session_login(p_session_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_profile   public.profiles;
  v_existing  public.active_sessions;
  v_grace     INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING errcode = 'P0111';
  END IF;
  IF NOT v_profile.is_active THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'account_blocked');
  END IF;

  SELECT session_grace_sec INTO v_grace FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_existing FROM public.active_sessions
    WHERE user_id = v_user_id FOR UPDATE;

  IF FOUND
     AND v_existing.session_token <> p_session_token
     AND v_existing.last_seen_at > NOW() - make_interval(secs => v_grace)
  THEN
    -- Another device is still heartbeating. Refuse, do not displace.
    RETURN jsonb_build_object(
      'allowed', false,
      'reason',  'session_active_elsewhere',
      'seconds_until_free',
        GREATEST(0, v_grace - EXTRACT(EPOCH FROM (NOW() - v_existing.last_seen_at))::INT)
    );
  END IF;

  INSERT INTO public.active_sessions (user_id, session_token, last_seen_at)
  VALUES (v_user_id, p_session_token, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET session_token = EXCLUDED.session_token,
        last_seen_at  = NOW();

  RETURN jsonb_build_object(
    'allowed',        true,
    'user_id',        v_profile.id,
    'username',       v_profile.username,
    'role',           v_profile.role,
    'coin_balance',   v_profile.coin_balance,
    'ledger_version', v_profile.ledger_version
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.session_heartbeat(p_session_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile public.profiles;
  v_token   TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'account_blocked');
  END IF;

  SELECT session_token INTO v_token FROM public.active_sessions WHERE user_id = v_user_id;
  IF v_token IS NULL OR v_token <> p_session_token THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'session_displaced');
  END IF;

  UPDATE public.active_sessions SET last_seen_at = NOW() WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'allowed',        true,
    'coin_balance',   v_profile.coin_balance,
    'ledger_version', v_profile.ledger_version
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.session_logout()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;
  DELETE FROM public.active_sessions WHERE user_id = v_user_id;
  RETURN jsonb_build_object('success', true);
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — ROUND LIFECYCLE
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_play_limits()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE v public.play_limits;
BEGIN
  SELECT * INTO v FROM public.play_limits WHERE id = 'global';
  RETURN jsonb_build_object(
    'single', jsonb_build_object('min', v.single_min, 'max', v.single_max),
    'double', jsonb_build_object('min', v.double_min, 'max', v.double_max),
    'triple', jsonb_build_object('min', v.triple_min, 'max', v.triple_max)
  );
END;
$$;


-- House-controlled draw. Scans all 1,000 combinations and picks the one whose
-- payout lands closest to total_stake * rtp%. With no stake there is nothing to
-- optimise, so the digits are drawn with a CSPRNG.
--
-- v1 used md5('bsg_tc_seed_' || round_number) for the no-stake case, which is
-- publicly reproducible — anyone who worked out the seed could predict those
-- rounds (finding N-2). gen_random_bytes removes that.
CREATE OR REPLACE FUNCTION public.draw_round(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round        public.rounds;
  v_rtp          NUMERIC;
  v_stake        BIGINT := 0;
  v_target       NUMERIC;
  v_s            BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[10]);
  v_d            BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[100]);
  v_t            BIGINT[] := ARRAY_FILL(0::BIGINT, ARRAY[1000]);
  v_bet          RECORD;
  v_k            TEXT;
  v_v            BIGINT;
  v_r INT; v_g INT; v_b INT;
  v_payout       NUMERIC;
  v_diff         NUMERIC;
  v_best_diff    NUMERIC := NULL;
  v_best_r INT := 0; v_best_g INT := 0; v_best_b INT := 0;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found' USING errcode = 'P0120';
  END IF;
  IF v_round.red IS NOT NULL THEN
    RETURN jsonb_build_object('already_drawn', true,
      'red', v_round.red, 'green', v_round.green, 'black', v_round.black);
  END IF;

  SELECT rtp_percentage INTO v_rtp FROM public.game_config WHERE id = 'global';

  FOR v_bet IN SELECT single_bets, double_bets, triple_bets, total_stake
                 FROM public.bets WHERE round_id = p_round_id
  LOOP
    v_stake := v_stake + v_bet.total_stake;
    FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(v_bet.single_bets) LOOP
      v_s[v_k::INT + 1] := v_s[v_k::INT + 1] + v_v;
    END LOOP;
    FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(v_bet.double_bets) LOOP
      v_d[v_k::INT + 1] := v_d[v_k::INT + 1] + v_v;
    END LOOP;
    FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(v_bet.triple_bets) LOOP
      v_t[v_k::INT + 1] := v_t[v_k::INT + 1] + v_v;
    END LOOP;
  END LOOP;

  IF v_stake > 0 THEN
    v_target := v_stake * (v_rtp / 100.0);
    FOR v_r IN 0..9 LOOP
      FOR v_g IN 0..9 LOOP
        FOR v_b IN 0..9 LOOP
          v_payout := (v_s[v_b + 1] * 9.0)
                    + (v_d[(v_g * 10 + v_b) + 1] * 90.0)
                    + (v_t[(v_r * 100 + v_g * 10 + v_b) + 1] * 900.0);
          v_diff := abs(v_payout - v_target);
          IF v_best_diff IS NULL OR v_diff < v_best_diff THEN
            v_best_diff := v_diff;
            v_best_r := v_r; v_best_g := v_g; v_best_b := v_b;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  ELSE
    v_best_r := (get_byte(gen_random_bytes(1), 0) % 10);
    v_best_g := (get_byte(gen_random_bytes(1), 0) % 10);
    v_best_b := (get_byte(gen_random_bytes(1), 0) % 10);
  END IF;

  UPDATE public.rounds
     SET red = v_best_r, green = v_best_g, black = v_best_b,
         phase = 'drawing', total_stake = v_stake, drawn_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('red', v_best_r, 'green', v_best_g, 'black', v_best_b,
                            'total_stake', v_stake);
END;
$$;


-- Pays every unsettled bet on a drawn round. Idempotent: settled bets are
-- skipped, so it is safe to call repeatedly and there is exactly one payout
-- path (v1 had two that both credited — finding C-7).
CREATE OR REPLACE FUNCTION public.settle_round(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round   public.rounds;
  v_bet     public.bets;
  v_s_key   TEXT; v_d_key TEXT; v_t_key TEXT;
  v_s BIGINT; v_d BIGINT; v_t BIGINT; v_total BIGINT;
  v_count   INT := 0;
  v_paid    BIGINT := 0;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.red IS NULL THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'not_drawn');
  END IF;

  -- One canonical key form. place_bet guarantees keys are stored zero-padded,
  -- so no fallback lookups are needed.
  v_s_key := v_round.black::TEXT;
  v_d_key := v_round.green::TEXT || v_round.black::TEXT;
  v_t_key := v_round.red::TEXT || v_round.green::TEXT || v_round.black::TEXT;

  FOR v_bet IN SELECT * FROM public.bets
                WHERE round_id = p_round_id AND NOT is_settled FOR UPDATE
  LOOP
    v_s := COALESCE((v_bet.single_bets ->> v_s_key)::BIGINT, 0) * 9;
    v_d := COALESCE((v_bet.double_bets ->> v_d_key)::BIGINT, 0) * 90;
    v_t := COALESCE((v_bet.triple_bets ->> v_t_key)::BIGINT, 0) * 900;
    v_total := v_s + v_d + v_t;

    UPDATE public.bets
       SET single_payout = v_s, double_payout = v_d, triple_payout = v_t,
           total_payout  = v_total, is_settled = true, settled_at = NOW()
     WHERE id = v_bet.id;

    IF v_total > 0 THEN
      PERFORM public.apply_coin_movement(v_bet.user_id, NULL, 'payout', v_total, p_round_id);
      v_paid := v_paid + v_total;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.rounds
     SET phase = 'settled', total_payout = total_payout + v_paid, settled_at = NOW()
   WHERE id = p_round_id;

  RETURN jsonb_build_object('settled', v_count, 'paid', v_paid);
END;
$$;


-- The clock. Creates the round on demand, draws it once the betting window
-- (including its latency grace) has fully closed, then settles it.
--
-- draw_at_second is strictly greater than the bet cutoff used by place_bet, so
-- digits cannot exist while a bet is still acceptable. That is what makes the
-- outcome-disclosure window impossible rather than merely narrow (finding N-1).
CREATE OR REPLACE FUNCTION public.get_current_round()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle    CONSTANT INT := 103;
  v_now      BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_number   BIGINT := v_now / v_cycle;
  v_into     INT    := (v_now % v_cycle)::INT;
  v_left     INT    := v_cycle - (v_now % v_cycle)::INT;
  v_draw_at  INT;
  v_round    public.rounds;
BEGIN
  SELECT draw_at_second INTO v_draw_at FROM public.game_config WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  IF NOT FOUND THEN
    INSERT INTO public.rounds (round_number, scheduled_at, phase)
    VALUES (v_number, to_timestamp((v_number + 1) * v_cycle), 'betting')
    ON CONFLICT (round_number) DO NOTHING;
    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  IF v_into >= v_draw_at THEN
    IF v_round.red IS NULL THEN
      PERFORM public.draw_round(v_round.id);
    END IF;
    PERFORM public.settle_round(v_round.id);
    SELECT * INTO v_round FROM public.rounds WHERE round_number = v_number;
  END IF;

  RETURN jsonb_build_object(
    'round_id',          v_round.id,
    'round_number',      v_round.round_number,
    'phase',             v_round.phase,
    'scheduled_at',      v_round.scheduled_at,
    'seconds_remaining', v_left,
    'seconds_into',      v_into,
    'draw_at_second',    v_draw_at,
    'red',               v_round.red,
    'green',             v_round.green,
    'black',             v_round.black
  );
END;
$$;


-- Last N settled rounds for the history strip. Returns only what actually
-- happened — v1 synthesised MD5 digits for rounds with no row, so the grid
-- could show results that never settled a bet (finding C-3).
CREATE OR REPLACE FUNCTION public.get_recent_rounds(p_limit INT DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x ORDER BY x_round_number DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT r.round_number AS x_round_number,
           jsonb_build_object(
             'round_id', r.id, 'round_number', r.round_number,
             'red', r.red, 'green', r.green, 'black', r.black,
             'scheduled_at', r.scheduled_at
           ) AS x
    FROM public.rounds r
    WHERE r.red IS NOT NULL
    ORDER BY r.round_number DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  ) s;
  RETURN v;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — BETTING
-- ═════════════════════════════════════════════════════════════════════════════

-- Places or replaces this player's bet for a round.
--
-- The client's stake total is NOT a parameter: it is recomputed here. v1
-- accepted p_total_stake and ignored it, which was safe but confusing.
--
-- Keys are validated to one canonical zero-padded form, so settlement can do a
-- single lookup. v1 accepted any format and compensated with padded/unpadded/
-- int fallbacks at three separate call sites.
CREATE OR REPLACE FUNCTION public.place_bet(
  p_round_id    UUID,
  p_single_bets JSONB,
  p_double_bets JSONB,
  p_triple_bets JSONB
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_profile  public.profiles;
  v_round    public.rounds;
  v_lim      public.play_limits;
  v_cfg      public.game_config;
  v_cycle    CONSTANT INT := 103;
  v_into     INT := (EXTRACT(EPOCH FROM NOW())::BIGINT % v_cycle)::INT;
  v_k        TEXT;
  v_v        BIGINT;
  v_stake    BIGINT := 0;
  v_prev     BIGINT := 0;
  v_delta    BIGINT;
  v_balance  BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_BLOCKED' USING errcode = 'P0113';
  END IF;
  IF v_profile.role <> 'player' THEN
    RAISE EXCEPTION 'Only players may place bets' USING errcode = 'P0114';
  END IF;

  SELECT * INTO v_cfg FROM public.game_config WHERE id = 'global';
  SELECT * INTO v_lim FROM public.play_limits WHERE id = 'global';

  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND' USING errcode = 'P0120';
  END IF;

  -- Two independent guards. Either alone would do; together they make it
  -- impossible to bet on a round whose outcome exists.
  IF v_round.red IS NOT NULL THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;
  IF v_into >= v_cfg.draw_at_second THEN
    RAISE EXCEPTION 'ROUND_CLOSED' USING errcode = 'P0121';
  END IF;

  -- ── validate + total, one board at a time ────────────────────────────────
  FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(COALESCE(p_single_bets,'{}')) LOOP
    IF v_k !~ '^[0-9]$' THEN RAISE EXCEPTION 'BAD_SINGLE_KEY:%', v_k USING errcode='P0122'; END IF;
    IF v_v < v_lim.single_min THEN RAISE EXCEPTION 'BELOW_MIN' USING errcode='P0123'; END IF;
    IF v_v > v_lim.single_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode='P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(COALESCE(p_double_bets,'{}')) LOOP
    IF v_k !~ '^[0-9]{2}$' THEN RAISE EXCEPTION 'BAD_DOUBLE_KEY:%', v_k USING errcode='P0122'; END IF;
    IF v_v < v_lim.double_min THEN RAISE EXCEPTION 'BELOW_MIN' USING errcode='P0123'; END IF;
    IF v_v > v_lim.double_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode='P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  FOR v_k, v_v IN SELECT key, value::BIGINT FROM jsonb_each_text(COALESCE(p_triple_bets,'{}')) LOOP
    IF v_k !~ '^[0-9]{3}$' THEN RAISE EXCEPTION 'BAD_TRIPLE_KEY:%', v_k USING errcode='P0122'; END IF;
    IF v_v < v_lim.triple_min THEN RAISE EXCEPTION 'BELOW_MIN' USING errcode='P0123'; END IF;
    IF v_v > v_lim.triple_max THEN RAISE EXCEPTION 'EXCEEDS_MAX' USING errcode='P0124'; END IF;
    v_stake := v_stake + v_v;
  END LOOP;

  IF v_stake <= 0 THEN
    RAISE EXCEPTION 'EMPTY_BET' USING errcode = 'P0125';
  END IF;

  -- Replacing an existing bet charges only the difference.
  SELECT total_stake INTO v_prev FROM public.bets
    WHERE round_id = p_round_id AND user_id = v_user FOR UPDATE;
  v_prev  := COALESCE(v_prev, 0);
  v_delta := v_stake - v_prev;

  IF v_delta <> 0 THEN
    -- A reduced bet is a stake_refund, never a 'payout' — booking it as a
    -- payout would inflate every win statistic in the dashboard.
    v_balance := public.apply_coin_movement(
      v_user, NULL, CASE WHEN v_delta > 0 THEN 'stake' ELSE 'stake_refund' END,
      -v_delta, p_round_id);
  ELSE
    v_balance := v_profile.coin_balance;
  END IF;

  INSERT INTO public.bets (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
  VALUES (p_round_id, v_user,
          COALESCE(p_single_bets,'{}'), COALESCE(p_double_bets,'{}'),
          COALESCE(p_triple_bets,'{}'), v_stake)
  ON CONFLICT (round_id, user_id) DO UPDATE
    SET single_bets = EXCLUDED.single_bets,
        double_bets = EXCLUDED.double_bets,
        triple_bets = EXCLUDED.triple_bets,
        total_stake = EXCLUDED.total_stake,
        is_settled  = false,
        single_payout = 0, double_payout = 0, triple_payout = 0, total_payout = 0;

  RETURN jsonb_build_object(
    'success',        true,
    'total_stake',    v_stake,
    'coin_balance',   v_balance,
    'ledger_version', (SELECT ledger_version FROM public.profiles WHERE id = v_user)
  );
END;
$$;


-- Read-only. Settlement happens in settle_round via get_current_round; this
-- never credits, so there is exactly one payout path.
CREATE OR REPLACE FUNCTION public.get_my_round_result(p_round_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_bet  public.bets;
  v_p    public.profiles;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_user;
  SELECT * INTO v_bet FROM public.bets WHERE round_id = p_round_id AND user_id = v_user;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'placed_bet', false, 'total_stake', 0, 'total_payout', 0,
      'is_settled', false,
      'coin_balance', v_p.coin_balance, 'ledger_version', v_p.ledger_version);
  END IF;

  RETURN jsonb_build_object(
    'placed_bet',     true,
    'total_stake',    v_bet.total_stake,
    'single_payout',  v_bet.single_payout,
    'double_payout',  v_bet.double_payout,
    'triple_payout',  v_bet.triple_payout,
    'total_payout',   v_bet.total_payout,
    'is_settled',     v_bet.is_settled,
    'coin_balance',   v_p.coin_balance,
    'ledger_version', v_p.ledger_version
  );
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — CASHIER
-- ═════════════════════════════════════════════════════════════════════════════

-- Agent <-> their own player. Both directions, one function.
CREATE OR REPLACE FUNCTION public.agent_transfer_coins(
  p_player_id UUID,
  p_amount    BIGINT,
  p_direction TEXT           -- 'credit' (agent->player) | 'debit' (player->agent)
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller  UUID := auth.uid();
  v_role    TEXT;
  v_player  public.profiles;
  v_agent   UUID;
  v_pbal BIGINT; v_abal BIGINT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be a positive whole number' USING errcode = 'P0130';
  END IF;
  IF p_direction NOT IN ('credit','debit') THEN
    RAISE EXCEPTION 'direction must be credit or debit' USING errcode = 'P0131';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_caller AND is_active;
  IF v_role NOT IN ('agent','superadmin') THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING errcode = 'P0132';
  END IF;

  SELECT * INTO v_player FROM public.profiles WHERE id = p_player_id;
  IF NOT FOUND OR v_player.role <> 'player' THEN
    RAISE EXCEPTION 'Player not found' USING errcode = 'P0133';
  END IF;

  -- An agent may only move coins for their own players.
  IF v_role = 'agent' AND v_player.agent_id <> v_caller THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NOT_YOUR_PLAYER' USING errcode = 'P0134';
  END IF;
  v_agent := v_player.agent_id;

  IF p_direction = 'credit' THEN
    v_abal := public.apply_coin_movement(v_agent,     p_player_id, 'admin_debit',  -p_amount);
    v_pbal := public.apply_coin_movement(p_player_id, v_agent,     'agent_credit',  p_amount);
  ELSE
    v_pbal := public.apply_coin_movement(p_player_id, v_agent,     'agent_debit',  -p_amount);
    v_abal := public.apply_coin_movement(v_agent,     p_player_id, 'admin_credit',  p_amount);
  END IF;

  RETURN jsonb_build_object('success', true,
    'player_coin_balance', v_pbal, 'agent_coin_balance', v_abal);
END;
$$;


-- Superadmin -> agent. Coins are created/destroyed at this boundary, so this is
-- the only function that can increase the total money in the system.
CREATE OR REPLACE FUNCTION public.admin_issue_coins(
  p_agent_id  UUID,
  p_amount    BIGINT,
  p_direction TEXT           -- 'credit' | 'debit'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_role   TEXT;
  v_agent  public.profiles;
  v_bal    BIGINT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated' USING errcode = 'P0100';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be a positive whole number' USING errcode = 'P0130';
  END IF;
  IF p_direction NOT IN ('credit','debit') THEN
    RAISE EXCEPTION 'direction must be credit or debit' USING errcode = 'P0131';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_caller AND is_active;
  IF v_role <> 'superadmin' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SUPERADMIN_ONLY' USING errcode = 'P0135';
  END IF;

  SELECT * INTO v_agent FROM public.profiles WHERE id = p_agent_id;
  IF NOT FOUND OR v_agent.role <> 'agent' THEN
    RAISE EXCEPTION 'Agent not found' USING errcode = 'P0136';
  END IF;

  v_bal := public.apply_coin_movement(
    p_agent_id, v_caller,
    CASE WHEN p_direction = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END,
    CASE WHEN p_direction = 'credit' THEN p_amount ELSE -p_amount END);

  INSERT INTO public.audit_log (actor_id, kind, detail)
  VALUES (v_caller, 'coin',
    format('%s %s coins %s agent @%s',
      initcap(p_direction), p_amount,
      CASE WHEN p_direction='credit' THEN 'to' ELSE 'from' END, v_agent.username));

  RETURN jsonb_build_object('success', true, 'agent_coin_balance', v_bal);
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — INTEGRITY CHECK
-- ═════════════════════════════════════════════════════════════════════════════

-- Proves the ledger and the balances agree. Should always return zero rows.
-- Intended for a scheduled job and for the post-deploy verification run.
CREATE OR REPLACE FUNCTION public.verify_ledger_integrity()
RETURNS TABLE (user_id UUID, username TEXT, coin_balance BIGINT, ledger_sum BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT p.id, p.username, p.coin_balance,
         COALESCE(SUM(l.amount), 0)::BIGINT
  FROM public.profiles p
  LEFT JOIN public.coin_ledger l ON l.user_id = p.id
  GROUP BY p.id, p.username, p.coin_balance
  HAVING p.coin_balance <> COALESCE(SUM(l.amount), 0);
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — EXECUTE GRANTS
-- ═════════════════════════════════════════════════════════════════════════════
-- Default-deny, then grant only the client-facing surface. apply_coin_movement,
-- draw_round and settle_round are internal: exposing them would let a client
-- mint coins or force a draw.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.session_login(TEXT)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_heartbeat(TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_logout()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_play_limits()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_round()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_rounds(INT)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bet(UUID,JSONB,JSONB,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_round_result(UUID)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_transfer_coins(UUID,BIGINT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_issue_coins(UUID,BIGINT,TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_role_name()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_is_active()            TO authenticated;

COMMIT;
