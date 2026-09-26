-- Gembird $OWL pack shelf: 70% $OWL / 30% NFT / 0% SOL cash (separate from main 30/30/40).
-- Open RNG reads matching constants in lib/packs/product-pools.ts.

UPDATE public.pack_products
SET
  category_owl_bps = 7000,
  category_sol_bps = 0,
  category_nft_bps = 3000,
  updated_at = now()
WHERE slug = 'owl-pack-owl-v1';
