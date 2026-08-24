-- Allow premium/grail NFTs above the original 0.5 SOL fair-value cap.
-- Odds use per-mint inverse floor-price weights with a dynamic pool max FP.

ALTER TABLE public.pack_inventory
  DROP CONSTRAINT IF EXISTS pack_inventory_fair_value_sol_check;

ALTER TABLE public.pack_inventory
  ADD CONSTRAINT pack_inventory_fair_value_sol_check
  CHECK (fair_value_sol >= 0.05 AND fair_value_sol <= 50);

COMMENT ON COLUMN public.pack_inventory.fair_value_sol IS
  'Admin-tagged floor price in SOL (0.05–50). Higher FP = rarer NFT prize odds.';
