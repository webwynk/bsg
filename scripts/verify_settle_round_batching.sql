-- ============================================================================
-- Manual verification script for 20260808000900_batch_settle_round_payouts.sql
-- ============================================================================
--
-- WHAT THIS IS
--   A one-off test script, NOT a migration. It is never applied automatically
--   and does nothing on its own -- you run it by hand, section by section,
--   against a LOCAL OR STAGING Supabase instance only.
--
--   ‼ DO NOT RUN THIS AGAINST PRODUCTION. It inserts a fake round and fake
--     bets, and pays out real coin_balance increases to whichever existing
--     player accounts it picks. Section 6 deletes the test round when you're
--     done; run it, or clean up manually afterward.
--
-- WHAT IT PROVES
--   1. The new batched settle_round() pays every bet exactly what an
--      independent, from-scratch calculation says it should -- not
--      "probably close," byte-for-byte identical.
--   2. Losers are correctly settled with zero payout and never touched
--      financially.
--   3. A player who wins on more than one board at once (single + triple
--      together) gets the correct combined total, not just one of them.
--   4. Calling settle_round a second time on an already-settled round is a
--      safe no-op -- nobody gets paid twice.
--   5. The standing invariant (Section 5) -- total recorded bet payouts must
--      exactly equal total ledger payout entries -- holds. Keep that query;
--      it's safe to run against any real round, any time, forever.
--
-- PREREQUISITE
--   At least 5 player accounts must already exist (sign up 5 test players
--   through the app first, or use existing ones on your local instance).
--   This script reads real player ids rather than fabricating fake ones,
--   since profiles.id is a foreign key into auth.users and cannot be faked
--   with a plain INSERT.
-- ============================================================================


-- ── Section 1: pick 5 existing players and snapshot their balances ─────────
-- Run this first and note the 5 ids and starting balances it prints.

WITH test_players AS (
  SELECT id, username, coin_balance
    FROM public.profiles
   WHERE role = 'player'
   ORDER BY created_at
   LIMIT 5
)
SELECT * FROM test_players;


-- ── Section 2: create a throwaway round with a KNOWN winning number ────────
-- Winning number is fixed at red=0, green=4, black=7  ->  single key "7",
-- double key "47", triple key "047". Already drawn and phase 'drawing', so
-- settle_round will accept it (mirrors a real round right after draw_round
-- has run, before settlement).

INSERT INTO public.rounds (round_number, scheduled_at, phase, red, green, black, drawn_at)
VALUES (999999999, NOW(), 'drawing', 0, 4, 7, NOW())
RETURNING id AS test_round_id;
-- Copy the returned id -- you'll paste it into every query below as
-- '<TEST_ROUND_ID>'.


-- ── Section 3: place a deliberately mixed set of test bets ─────────────────
-- Using the 5 player ids from Section 1, in order, as player_1..player_5.
-- Covers: single win, double win, triple win, a COMBINED win (single +
-- triple together, to prove multi-board wins add up correctly), and a loser.

-- Replace the <player_N_id> placeholders and <TEST_ROUND_ID> before running.

INSERT INTO public.bets (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
VALUES
  ('<TEST_ROUND_ID>', '<player_1_id>', '{"7": 10}',   '{}',        '{}',        10),  -- expect single win: 10*9   = 90
  ('<TEST_ROUND_ID>', '<player_2_id>', '{}',          '{"47": 10}','{}',        10),  -- expect double win: 10*90  = 900
  ('<TEST_ROUND_ID>', '<player_3_id>', '{}',          '{}',        '{"047": 10}',10), -- expect triple win: 10*900 = 9000
  ('<TEST_ROUND_ID>', '<player_4_id>', '{"7": 10}',   '{}',        '{"047": 10}',20), -- expect combined:  90+9000 = 9090
  ('<TEST_ROUND_ID>', '<player_5_id>', '{"3": 10}',   '{}',        '{}',        10);  -- expect loser:            0


-- ── Section 4: run the new settle_round, then check every number by hand ───

SELECT public.settle_round('<TEST_ROUND_ID>');
-- Expect: {"settled": 5, "paid": 10080, "fully_settled": true}
-- (90 + 900 + 9000 + 9090 + 0 = 10080)

-- Now the independent check: this recomputes each bet's expected payout
-- FROM SCRATCH, without calling settle_round or trusting its own output, and
-- compares it against what actually got written. Every row's "match" column
-- must say true.
SELECT
  p.username,
  b.single_payout, b.double_payout, b.triple_payout, b.total_payout,
  b.is_settled,
  (b.total_payout = b.single_payout + b.double_payout + b.triple_payout) AS sums_consistent,
  CASE p.username
    WHEN (SELECT username FROM public.profiles WHERE id = '<player_1_id>') THEN b.total_payout = 90
    WHEN (SELECT username FROM public.profiles WHERE id = '<player_2_id>') THEN b.total_payout = 900
    WHEN (SELECT username FROM public.profiles WHERE id = '<player_3_id>') THEN b.total_payout = 9000
    WHEN (SELECT username FROM public.profiles WHERE id = '<player_4_id>') THEN b.total_payout = 9090
    WHEN (SELECT username FROM public.profiles WHERE id = '<player_5_id>') THEN b.total_payout = 0
  END AS matches_expected
FROM public.bets b
JOIN public.profiles p ON p.id = b.user_id
WHERE b.round_id = '<TEST_ROUND_ID>';

-- Confirm each winner's balance actually increased by exactly their payout
-- (compare against the "before" balances you noted from Section 1).
SELECT username, coin_balance AS balance_after_settlement
  FROM public.profiles
 WHERE id IN ('<player_1_id>','<player_2_id>','<player_3_id>','<player_4_id>','<player_5_id>');


-- ── Section 5: the standing reconciliation invariant ────────────────────────
-- This must always return TRUE for any settled round, forever -- not just
-- this test. Keep this query and re-run it any time you want to sanity-check
-- a real round.
SELECT
  (SELECT COALESCE(SUM(total_payout), 0) FROM public.bets
    WHERE round_id = '<TEST_ROUND_ID>') AS total_recorded_on_bets,
  (SELECT COALESCE(SUM(amount), 0) FROM public.coin_ledger
    WHERE round_id = '<TEST_ROUND_ID>' AND kind = 'payout') AS total_recorded_on_ledger,
  (SELECT COALESCE(SUM(total_payout), 0) FROM public.bets WHERE round_id = '<TEST_ROUND_ID>')
    = (SELECT COALESCE(SUM(amount), 0) FROM public.coin_ledger WHERE round_id = '<TEST_ROUND_ID>' AND kind = 'payout')
    AS reconciles;


-- ── Section 6: idempotency check -- calling it again must pay nobody twice ─

SELECT public.settle_round('<TEST_ROUND_ID>');
-- Expect: {"settled": 0, "paid": 0, "reason": "already_settled"}

-- Confirm balances are UNCHANGED from Section 4's numbers (re-run the same
-- balance query above) -- if any number moved, something is badly wrong.


-- ── Section 7: cleanup ───────────────────────────────────────────────────────
-- Removes the test round, its bets (cascade), and its ledger entries. Player
-- coin_balance/ledger_version are NOT reverted automatically -- if you need
-- the test players back to their exact starting balance, restore it manually
-- using the Section 1 snapshot.

DELETE FROM public.coin_ledger WHERE round_id = '<TEST_ROUND_ID>';
DELETE FROM public.rounds WHERE id = '<TEST_ROUND_ID>';  -- cascades to bets


-- ============================================================================
-- OPTIONAL: large-scale batching test (only if you want to actually exercise
-- the multi-batch path, e.g. approximating the 100,000-player question).
-- ============================================================================
--
-- v_batch_size is a hardcoded constant (3000) inside settle_round, so to
-- actually FORCE more than one batch you need more than 3000 unsettled bets
-- on a single test round. Generating that many synthetic bets (and the
-- matching player accounts, since profiles.id must reference a real
-- auth.users row) is significantly more setup than this script covers.
--
-- The pragmatic approach: temporarily lower v_batch_size (e.g. to 5) in a
-- LOCAL-ONLY copy of the function, repeat Sections 2-6 with ~12-15 test bets
-- instead of 5, and confirm settle_round correctly reports fully_settled:
-- false after the first call and fully_settled: true only once every bet is
-- processed, with the reconciliation check (Section 5) still holding after
-- each partial call, not just at the end.
