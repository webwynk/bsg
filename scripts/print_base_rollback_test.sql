-- Rollback-only checks of the print base, for after both migrations are applied.
-- Rows are obviously fake and the file ends in ROLLBACK, so accounts, IDs,
-- counters, settings and audit rows return to exactly what they were (RULE 6C).
-- A failed check stops the file with an exception, which rolls back too.
BEGIN;

DO $$
DECLARE
  v_admin  UUID;
  v_agent  UUID;
  v_player UUID := gen_random_uuid();
  v_now    TIMESTAMPTZ := NOW();
  v_later  TIMESTAMPTZ := NOW() + INTERVAL '10 minutes';
  v_result JSONB;
  v_t      RECORD;
  v_failed BOOLEAN := false;
BEGIN
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'superadmin' AND is_active LIMIT 1;
  SELECT id INTO v_agent FROM public.profiles WHERE role = 'agent' LIMIT 1;
  IF v_admin IS NULL OR v_agent IS NULL THEN RAISE EXCEPTION 'need a superadmin and an agent'; END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data, instance_id, aud, role)
  VALUES (v_player, 'zzprint01@bestsmartgame.com',
          jsonb_build_object('username', 'zzprint01', 'full_name', 'probe', 'role', 'player', 'agent_id', v_agent),
          '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Off until turned on.
  IF public.print_active_for_round(v_player, v_later) THEN RAISE EXCEPTION 'active before enabling'; END IF;

  -- On from the next round, not this one.
  v_result := public.set_print_enabled(v_player, true);
  IF NOT (v_result->>'changed')::BOOLEAN THEN RAISE EXCEPTION 'enable: %', v_result; END IF;
  IF public.print_active_for_round(v_player, v_now) THEN RAISE EXCEPTION 'active this round'; END IF;
  IF NOT public.print_active_for_round(v_player, v_later) THEN RAISE EXCEPTION 'not active next round'; END IF;

  -- Repeating changes nothing.
  v_result := public.set_print_enabled(v_player, true);
  IF (v_result->>'changed')::BOOLEAN THEN RAISE EXCEPTION 'double enable changed: %', v_result; END IF;

  -- Ticket numbers go up.
  SELECT * INTO v_t FROM public.print_allocate_ticket(v_player, 'LS');
  IF v_t.ticket_no <> 1 OR v_t.ticket_code !~ '^LS-Z[0-9]{2,}-0001$' THEN RAISE EXCEPTION 'first ticket: %', v_t; END IF;
  SELECT * INTO v_t FROM public.print_allocate_ticket(v_player, 'LS');
  IF v_t.ticket_no <> 2 THEN RAISE EXCEPTION 'second ticket: %', v_t; END IF;
  SELECT * INTO v_t FROM public.print_allocate_ticket(v_player, 'TC');
  IF v_t.ticket_no <> 1 THEN RAISE EXCEPTION 'games must count separately: %', v_t; END IF;

  -- Refusals.
  BEGIN
    PERFORM public.print_allocate_ticket(v_player, 'XX');
    v_failed := true;
  EXCEPTION WHEN SQLSTATE 'P0154' THEN NULL;
  END;
  IF v_failed THEN RAISE EXCEPTION 'bad game accepted'; END IF;

  BEGIN
    PERFORM public.set_print_enabled(v_agent, true);
    v_failed := true;
  EXCEPTION WHEN SQLSTATE 'P0150' THEN NULL;
  END;
  IF v_failed THEN RAISE EXCEPTION 'agent accepted as print player'; END IF;

  RAISE NOTICE 'All print base checks passed.';
END;
$$;

ROLLBACK;
