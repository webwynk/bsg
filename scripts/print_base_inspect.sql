-- Read-only checks to run BEFORE the print base migrations. Changes nothing.
-- Every expected-empty query must return no rows.

-- 1. No print objects exist yet.
SELECT 'exists already' AS problem, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname LIKE 'print\_%' ESCAPE '\';

SELECT 'exists already' AS problem, p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND (p.proname LIKE 'print\_%' ESCAPE '\' OR p.proname LIKE 'set\_print\_%' ESCAPE '\');

-- 2. The new refusal codes are unused by any live function.
SELECT 'code in use' AS problem, p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND pg_get_functiondef(p.oid) ~ 'P015[0-4]' AND p.prokind = 'f';

-- 3. What these migrations rely on is there. Expect one row of all true.
SELECT to_regclass('public.account_codes') IS NOT NULL AS account_codes,
       to_regclass('public.rounds') IS NOT NULL AS rounds,
       to_regclass('public.lucky_card_rounds') IS NOT NULL AS lucky_card_rounds,
       to_regclass('public.spin2win_rounds') IS NOT NULL AS spin2win_rounds,
       to_regclass('public.lucky16_rounds') IS NOT NULL AS lucky16_rounds,
       to_regproc('public.current_role_name') IS NOT NULL AS current_role_name,
       to_regproc('public.current_is_active') IS NOT NULL AS current_is_active;

-- 4. Players without an ID, who could not be turned on. Expect none.
SELECT 'no ID' AS problem, p.username
  FROM public.profiles p
 WHERE p.role = 'player'
   AND NOT EXISTS (SELECT 1 FROM public.account_codes c WHERE c.user_id = p.id);
