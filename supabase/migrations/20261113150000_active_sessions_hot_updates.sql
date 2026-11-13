-- ############################################################################
-- active_sessions: make heartbeat / dashboard "last seen" updates HOT (in place)
-- Migration: 20261113150000_active_sessions_hot_updates.sql
-- Plan:  docs/loadtest/SESSIONS_INDEX_FIX_PLAN_2026-11-13.md
-- Audit: docs/loadtest/HEARTBEAT_AUDIT_2026-11-13.md
-- ############################################################################
--
-- idx_sessions_seen (btree on last_seen_at) was created in
-- 20260807000000_rebuild_v2_schema.sql and has had 0 scans since the
-- statistics reset on 2026-09-29. Every reader and writer of active_sessions
-- (session_login, session_heartbeat, session_logout, staff_session_login,
-- staff_session_touch, staff_auth_check, attempt_player_login,
-- attempt_staff_login, set_agent_active, and the dashboard's
-- .in('user_id', ...) reads and .eq('user_id', ...) deletes) goes by user_id,
-- the primary key. The only last_seen_at comparisons are on a row already
-- fetched by user_id.
--
-- Because that index covers the column every heartbeat (every 15 s per
-- player) and every dashboard action changes, PostgreSQL could not do a HOT
-- (heap-only, in-place) update: 78 of 205,335 updates were HOT. Without it,
-- those updates touch no index at all.
--
-- fillfactor 70 keeps free room in each page, so the new row version fits on
-- the same page (a HOT requirement). It applies to pages written from now
-- on. The table is about 11 rows on one heap page with plenty of free space,
-- so no rewrite (VACUUM FULL) is needed.
--
-- Unchanged: every function, the primary key, the foreign key, RLS, grants,
-- session_grace_sec. Undo: scripts/active_sessions_hot_updates_rollback.sql
-- ############################################################################

BEGIN;

-- Both statements take a brief lock on this tiny table. Waiting longer than
-- this for it means something unexpected holds it: fail instead of queueing
-- heartbeats behind it.
SET LOCAL lock_timeout = '3s';

DROP INDEX public.idx_sessions_seen;

ALTER TABLE public.active_sessions SET (fillfactor = 70);

COMMIT;
