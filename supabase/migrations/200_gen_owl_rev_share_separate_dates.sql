-- Separate "next rev share" dates for Gen 1 and Gen 2 (they no longer pay out on the same day).
-- next_date stays as the legacy/site-wide value and tracks Gen 1 for older clients.

ALTER TABLE public.rev_share_schedule
  ADD COLUMN IF NOT EXISTS gen1_next_date TEXT,
  ADD COLUMN IF NOT EXISTS gen2_next_date TEXT;

COMMENT ON COLUMN public.rev_share_schedule.gen1_next_date IS
  'Founder-set display date for the next Gen 1 rev share payout (free text, e.g. "31 Aug").';
COMMENT ON COLUMN public.rev_share_schedule.gen2_next_date IS
  'Founder-set display date for the next Gen 2 rev share payout (free text, e.g. "31 Aug").';

-- Seed both from the existing shared date so nothing shows "—" right after deploy.
UPDATE public.rev_share_schedule
SET gen1_next_date = COALESCE(gen1_next_date, next_date),
    gen2_next_date = COALESCE(gen2_next_date, next_date)
WHERE id = 'default';
