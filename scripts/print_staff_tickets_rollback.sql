-- Undoes 20261102100000_print_staff_tickets.sql.
-- Read-only function, so nothing is lost. The dashboard's ticket lists stop working.

BEGIN;

DROP FUNCTION public.print_staff_tickets(UUID, TEXT, BIGINT[]);

COMMIT;
