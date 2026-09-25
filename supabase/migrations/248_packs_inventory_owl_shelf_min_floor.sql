-- Allow 0.01 SOL NFT floors on the $OWL cheap shelf (app enforces 0.05 min on main shelf).

ALTER TABLE public.pack_inventory
  DROP CONSTRAINT IF EXISTS pack_inventory_fair_value_sol_check;

ALTER TABLE public.pack_inventory
  ADD CONSTRAINT pack_inventory_fair_value_sol_check
  CHECK (fair_value_sol >= 0.01 AND fair_value_sol <= 50);

COMMENT ON COLUMN public.pack_inventory.fair_value_sol IS
  'Admin-tagged floor price in SOL (0.01–50 at DB; main shelf min 0.05 in app). Higher FP = rarer NFT prize odds.';
