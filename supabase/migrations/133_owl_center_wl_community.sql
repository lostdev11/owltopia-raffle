-- Optional WL community tag (Discord FCFS collab channels).
ALTER TABLE public.owl_center_wl_allocations
  ADD COLUMN IF NOT EXISTS community text;

COMMENT ON COLUMN public.owl_center_wl_allocations.community IS
  'FCFS collab slug (e.g. pandarianz, sharkyfi) for admin WL reporting.';
