-- ROLLBACK for supabase/migrations/20261113150000_active_sessions_hot_updates.sql
-- Puts back exactly what was there before: the btree index on last_seen_at
-- (same name and definition as 20260807000000_rebuild_v2_schema.sql:223) and
-- the default fillfactor. The table is tiny, so the index builds instantly.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE INDEX IF NOT EXISTS idx_sessions_seen ON public.active_sessions USING btree (last_seen_at);

ALTER TABLE public.active_sessions RESET (fillfactor);

COMMIT;
