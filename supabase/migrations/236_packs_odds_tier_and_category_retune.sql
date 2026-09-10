-- Packs reward retune: admin-flagged 1% NFT odds tier (Gembird).
-- Floor price still drives inverse-FP weights within each pool.

ALTER TABLE public.pack_inventory
  ADD COLUMN IF NOT EXISTS odds_tier text NOT NULL DEFAULT 'standard';

ALTER TABLE public.pack_inventory
  DROP CONSTRAINT IF EXISTS pack_inventory_odds_tier_check;

ALTER TABLE public.pack_inventory
  ADD CONSTRAINT pack_inventory_odds_tier_check
  CHECK (odds_tier IN ('standard', 'premium_1pct'));

CREATE INDEX IF NOT EXISTS pack_inventory_status_odds_tier_idx
  ON public.pack_inventory (status, odds_tier);

COMMENT ON COLUMN public.pack_inventory.odds_tier IS
  'standard = filler NFT pool; premium_1pct = shared ~1% overall chase pool (admin flag, not FP alone).';

-- Align display category bps with Gembird mix (30/30/40). Open RNG uses code constants.
UPDATE public.pack_products
SET
  category_owl_bps = 3000,
  category_sol_bps = 3000,
  category_nft_bps = 4000,
  updated_at = now()
WHERE slug = 'owl-pack-v1';
