-- Rollback-only checks of the account ID objects, for after
-- 20261031120000_account_codes.sql is applied. Every row is obviously fake and
-- the file ends in ROLLBACK, so counters and IDs return to exactly what they
-- were (RULE 6C). It calls assign_account_code directly with made-up UUIDs and
-- does not create accounts. A failed check stops the file with an exception,
-- which rolls back too.
BEGIN;

DO $$
DECLARE
  v_first  INTEGER;
  v_code   TEXT;
  v_again  TEXT;
  v_digit  TEXT;
  v_lower  TEXT;
  v_id     UUID := gen_random_uuid();
  v_before INTEGER;
BEGIN
  SELECT count(*) INTO v_before FROM public.account_codes;

  -- A letter's next number, and the same account twice gets the same ID.
  SELECT COALESCE(last_number, 0) INTO v_first FROM public.account_code_counters WHERE letter = 'Q';
  v_first := COALESCE(v_first, 0);
  v_code  := public.assign_account_code(v_id, 'qzzprobe01');
  v_again := public.assign_account_code(v_id, 'qzzprobe01');
  IF v_code <> v_again THEN RAISE EXCEPTION 'second call changed the ID: % %', v_code, v_again; END IF;
  IF v_code <> 'Q' || lpad((v_first + 1)::TEXT, GREATEST(2, length((v_first + 1)::TEXT)), '0') THEN
    RAISE EXCEPTION 'wrong next ID: %', v_code;
  END IF;

  -- Lowercase and uppercase share a letter.
  v_lower := public.assign_account_code(gen_random_uuid(), 'QZZPROBE02');
  IF v_lower NOT LIKE 'Q%' OR v_lower = v_code THEN RAISE EXCEPTION 'case handling: %', v_lower; END IF;

  -- A digit first uses X.
  v_digit := public.assign_account_code(gen_random_uuid(), '9zzprobe');
  IF v_digit NOT LIKE 'X%' THEN RAISE EXCEPTION 'digit first gave %', v_digit; END IF;

  -- Past 99: R100, not R00.
  UPDATE public.account_code_counters SET last_number = 99 WHERE letter = 'Q';
  v_code := public.assign_account_code(gen_random_uuid(), 'qzzprobe03');
  IF v_code <> 'Q100' THEN RAISE EXCEPTION 'past 99 gave %', v_code; END IF;

  RAISE NOTICE 'All account ID checks passed. % IDs before this test.', v_before;
END;
$$;

ROLLBACK;
