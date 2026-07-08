-- Gen 1 nest rev share: 90% standard / 10% 1/1 buckets (split evenly within each bucket).

ALTER TABLE public.gen_owl_rev_share_periods
  ADD COLUMN IF NOT EXISTS gen1_standard_eligible_count INT,
  ADD COLUMN IF NOT EXISTS gen1_one_of_one_eligible_count INT,
  ADD COLUMN IF NOT EXISTS gen1_standard_per_nest_sol NUMERIC(20, 9),
  ADD COLUMN IF NOT EXISTS gen1_standard_per_nest_usdc NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS gen1_one_of_one_per_nest_sol NUMERIC(20, 9),
  ADD COLUMN IF NOT EXISTS gen1_one_of_one_per_nest_usdc NUMERIC(20, 2);

COMMENT ON COLUMN public.gen_owl_rev_share_periods.gen1_standard_eligible_count IS
  'Eligible Gen 1 nests without the 1/1 Special trait at month-end.';
COMMENT ON COLUMN public.gen_owl_rev_share_periods.gen1_one_of_one_eligible_count IS
  'Eligible Gen 1 nests with the 1/1 Special trait at month-end.';
