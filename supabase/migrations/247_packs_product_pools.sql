-- Separate prize shelves per pack product (0.1 SOL vs $OWL checkout).
-- Same category odds % on both products; inventory + jackpot scoped by product_id.

ALTER TABLE public.pack_inventory
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.pack_products (id);

UPDATE public.pack_inventory
SET product_id = (SELECT id FROM public.pack_products WHERE slug = 'owl-pack-v1' LIMIT 1)
WHERE product_id IS NULL;

ALTER TABLE public.pack_inventory
  ALTER COLUMN product_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS pack_inventory_product_status_idx
  ON public.pack_inventory (product_id, status);

COMMENT ON COLUMN public.pack_inventory.product_id IS
  'Prize shelf: which pack SKU may draw this NFT (separate pools for SOL vs $OWL checkout).';

ALTER TABLE public.pack_products
  ADD COLUMN IF NOT EXISTS jackpot_pool_sol numeric(18, 9) NOT NULL DEFAULT 0
    CHECK (jackpot_pool_sol >= 0),
  ADD COLUMN IF NOT EXISTS jackpot_contribution_sol numeric(18, 9),
  ADD COLUMN IF NOT EXISTS jackpot_win_odds_bps integer NOT NULL DEFAULT 20
    CHECK (jackpot_win_odds_bps > 0 AND jackpot_win_odds_bps <= 10000),
  ADD COLUMN IF NOT EXISTS min_nft_count integer NOT NULL DEFAULT 1
    CHECK (min_nft_count >= 0),
  ADD COLUMN IF NOT EXISTS shelf_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shelf_pause_reason text;

COMMENT ON COLUMN public.pack_products.jackpot_pool_sol IS
  'Accumulating SOL jackpot for this product shelf only.';
COMMENT ON COLUMN public.pack_products.shelf_paused IS
  'When true, this product cannot be opened (other products may still sell).';

-- $OWL / cheap checkout shelf (same 30/30/40 category mix as main pack).
INSERT INTO public.pack_products (
  slug,
  name,
  price_sol,
  rtp_bps,
  category_owl_bps,
  category_sol_bps,
  category_nft_bps,
  active,
  min_nft_count
) VALUES (
  'owl-pack-owl-v1',
  'Owl Pack ($OWL)',
  0.1,
  8000,
  3000,
  3000,
  4000,
  true,
  1
) ON CONFLICT (slug) DO UPDATE SET
  category_owl_bps = EXCLUDED.category_owl_bps,
  category_sol_bps = EXCLUDED.category_sol_bps,
  category_nft_bps = EXCLUDED.category_nft_bps,
  updated_at = now();

-- Move legacy singleton jackpot balances onto the main 0.1 SOL product.
UPDATE public.pack_products p
SET
  jackpot_pool_sol = COALESCE(v.jackpot_pool_sol, 0),
  jackpot_contribution_sol = v.jackpot_contribution_sol,
  jackpot_win_odds_bps = COALESCE(v.jackpot_win_odds_bps, 20),
  min_nft_count = COALESCE(v.min_nft_count, 1)
FROM public.pack_vault_config v
WHERE p.slug = 'owl-pack-v1' AND v.id = 1;
