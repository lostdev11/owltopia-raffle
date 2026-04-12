-- Partner SPL prizes (e.g. TRQ with 9 decimals) need more than DECIMAL(10,2).
--
-- Live raffles / rows: this migration does NOT delete or update raffle rows. It only
-- widens prize_amount from DECIMAL(10,2) to NUMERIC(38,18). Existing stored values are
-- cast with USING to the same numeric value (no truncation vs old scale).
--
-- Operational note: ALTER TABLE takes a short ACCESS EXCLUSIVE lock on public.raffles.
-- Ticket writes may pause briefly during that window; plan a quiet moment if traffic is high.
--
-- PostgreSQL refuses ALTER TYPE on raffles.prize_amount while public.raffles_list
-- (or its internal _RETURN rule) depends on that column. Drop the view, alter, then
-- recreate. If your raffles_list was not simply "all columns from raffles", restore
-- the exact definition from a backup (pg_get_viewdef) before/after this migration.

DROP VIEW IF EXISTS public.raffles_list CASCADE;

ALTER TABLE public.raffles
  ALTER COLUMN prize_amount TYPE NUMERIC(38, 18)
  USING prize_amount::NUMERIC(38, 18);

CREATE VIEW public.raffles_list AS
SELECT *
FROM public.raffles;

-- Match migration 023: queries use invoker privileges so RLS on raffles applies.
ALTER VIEW public.raffles_list SET (security_invoker = on);

GRANT SELECT ON public.raffles_list TO anon, authenticated, service_role;
