-- Admin kill switch for Gen Owl nest rev-share SOL/USDC claims.
-- When false, claim endpoints reject and Nesting hides claim buttons; estimates still show.

ALTER TABLE public.rev_share_schedule
  ADD COLUMN IF NOT EXISTS claims_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.rev_share_schedule.claims_enabled IS
  'When false, Gen 1 / Gen 2 nest rev-share claims are disabled (admin off switch). Estimates and deposits still work.';

UPDATE public.rev_share_schedule
SET claims_enabled = true
WHERE id = 'default' AND claims_enabled IS NULL;
