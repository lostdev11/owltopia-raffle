-- .sol domains hub: raffles listed only under /raffles?tab=sol-domains (excluded from Main + Partner tabs).
-- Manual floor_price; no SNS API integration.

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS sol_domains_hub boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.raffles.sol_domains_hub IS
  'When true, raffle appears only in the .sol domains hub tab—not Main or Partner. NFT prizes; use floor_price for listed value.';

CREATE INDEX IF NOT EXISTS idx_raffles_sol_domains_hub
  ON public.raffles (sol_domains_hub)
  WHERE sol_domains_hub = true;
