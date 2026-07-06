-- Gen 1 / Gen 2 nesting rev share totals (founder-editable; split evenly per active nest at payout time).

ALTER TABLE public.rev_share_schedule
  ADD COLUMN IF NOT EXISTS gen1_total_sol NUMERIC(20, 9),
  ADD COLUMN IF NOT EXISTS gen1_total_usdc NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS gen2_total_sol NUMERIC(20, 9),
  ADD COLUMN IF NOT EXISTS gen2_total_usdc NUMERIC(20, 2);

COMMENT ON COLUMN public.rev_share_schedule.gen1_total_sol IS
  'Total SOL in the next Gen 1 owl nest rev share pool — divided evenly across active Gen 1 nests.';
COMMENT ON COLUMN public.rev_share_schedule.gen1_total_usdc IS
  'Total USDC in the next Gen 1 owl nest rev share pool — divided evenly across active Gen 1 nests.';
COMMENT ON COLUMN public.rev_share_schedule.gen2_total_sol IS
  'Total SOL in the next Gen 2 owl nest rev share pool — divided evenly across active Gen 2 nests.';
COMMENT ON COLUMN public.rev_share_schedule.gen2_total_usdc IS
  'Total USDC in the next Gen 2 owl nest rev share pool — divided evenly across active Gen 2 nests.';
