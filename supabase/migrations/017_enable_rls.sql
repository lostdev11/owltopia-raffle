-- Enable Row Level Security on raffles and entries.
-- Note: RLS is already enabled in 001_initial_schema; these ALTERs are idempotent.
-- Schema uses "entries", not "raffle_entries"; include both if you have a raffle_entries table.

ALTER TABLE public.raffles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

-- SELECT policies: allow read-all on raffles and entries
DROP POLICY IF EXISTS "raffles_read_all" ON public.raffles;
CREATE POLICY "raffles_read_all"
  ON public.raffles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "entries_read_all" ON public.raffle_entries;
CREATE POLICY "entries_read_all"
  ON public.raffle_entries FOR SELECT
  USING (true);
