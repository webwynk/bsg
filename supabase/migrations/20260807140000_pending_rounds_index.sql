-- Partial index for the scheduler's hot query.
--
-- tick_rounds() runs every 10 seconds and looks for rounds that are past their
-- draw time but not yet finished. In the steady state that set is empty or has
-- a single row, but `rounds` grows by 838 rows/day (one per 103s cycle), so
-- without an index the job degrades into a growing sequential scan forever —
-- roughly 300k rows/year, re-scanned 8,640 times a day.
--
-- The predicate matches the job's WHERE clause exactly, so the index only ever
-- contains rounds still awaiting a draw or settlement: normally 0-2 rows.
CREATE INDEX IF NOT EXISTS rounds_pending_idx
    ON public.rounds (round_number)
 WHERE red IS NULL OR phase <> 'settled';

COMMENT ON INDEX public.rounds_pending_idx IS
  'Keeps tick_rounds() O(1) as the rounds table grows. Matches its WHERE clause.';
