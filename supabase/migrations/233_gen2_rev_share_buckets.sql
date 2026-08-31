-- Gen 2 nest rev share: same 90% all-staked / 10% 1/1 bonus buckets as Gen 1.

ALTER TABLE public.gen_owl_rev_share_periods
  ADD COLUMN IF NOT EXISTS gen2_standard_eligible_count INT,
  ADD COLUMN IF NOT EXISTS gen2_one_of_one_eligible_count INT,
  ADD COLUMN IF NOT EXISTS gen2_standard_per_nest_sol NUMERIC(20, 9),
  ADD COLUMN IF NOT EXISTS gen2_standard_per_nest_usdc NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS gen2_one_of_one_per_nest_sol NUMERIC(20, 9),
  ADD COLUMN IF NOT EXISTS gen2_one_of_one_per_nest_usdc NUMERIC(20, 2);

COMMENT ON COLUMN public.gen_owl_rev_share_periods.gen2_standard_eligible_count IS
  'Eligible Gen 2 nests without the 1/1 trait at month-end.';
COMMENT ON COLUMN public.gen_owl_rev_share_periods.gen2_one_of_one_eligible_count IS
  'Eligible Gen 2 nests with the 1/1 trait at month-end.';
COMMENT ON COLUMN public.gen_owl_rev_share_periods.gen2_standard_per_nest_sol IS
  'Per-nest SOL from the 90% all-staked Gen 2 pool (every eligible Gen 2 nest receives this).';
COMMENT ON COLUMN public.gen_owl_rev_share_periods.gen2_one_of_one_per_nest_sol IS
  'Total per-nest SOL for a Gen 2 1/1 (90% all-staked share + 10% 1/1 bonus).';
