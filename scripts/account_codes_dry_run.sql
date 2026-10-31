-- Read-only preview of the IDs the backfill would give. Run it BEFORE
-- 20261031120000_account_codes.sql is applied: it reads profiles only and
-- changes nothing. Numbers are counted per letter, oldest account first, in the
-- same order as 20261031130000_account_codes_backfill.sql.
WITH accounts AS (
  SELECT id, username, role, created_at,
         CASE WHEN upper(left(username, 1)) ~ '^[A-Z]$'
              THEN upper(left(username, 1)) ELSE 'X' END AS letter
    FROM public.profiles
   WHERE role IN ('player', 'agent')
),
numbered AS (
  SELECT *, row_number() OVER (PARTITION BY letter ORDER BY created_at, lower(username)) AS number
    FROM accounts
)
SELECT letter || lpad(number::TEXT, GREATEST(2, length(number::TEXT)), '0') AS proposed_id,
       username, role, created_at
  FROM numbered
 ORDER BY letter, number;

-- Accounts sharing a created_at, ordered by username instead:
-- SELECT created_at, count(*) FROM public.profiles
--  WHERE role IN ('player','agent') GROUP BY created_at HAVING count(*) > 1;
