-- Product decision (2026-08-11): usernames must be letters and numbers only,
-- no underscore. Supersedes the earlier profiles_username_format CHECK, which
-- allowed underscore -- that earlier version was itself the reference Issue #7
-- (MASTER_AUDIT_AND_REMEDIATION_PLAN.md) converged the client-side dialogs on.
-- This migration, plus the matching updates to USERNAME_PATTERN and both
-- server actions in bsg_web_dashboard, reverses that direction so all four
-- layers (DB, both server actions, both client dialogs) agree on the new rule.
--
-- Verified live before writing this migration: zero existing usernames
-- contain an underscore or any other non-alphanumeric character, so no
-- account needs renaming for this tightened constraint to hold.

BEGIN;

ALTER TABLE public.profiles DROP CONSTRAINT profiles_username_format;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_format
  CHECK (username ~ '^[A-Za-z0-9]{3,20}$');

COMMIT;
