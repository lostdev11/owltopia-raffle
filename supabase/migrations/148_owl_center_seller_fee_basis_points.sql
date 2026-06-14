-- Creator secondary royalty (Metaplex seller_fee_basis_points) — set before Candy Machine deploy.

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS seller_fee_basis_points int NOT NULL DEFAULT 500;

ALTER TABLE public.owl_center_launches
  DROP CONSTRAINT IF EXISTS owl_center_launches_seller_fee_bps_check;

ALTER TABLE public.owl_center_launches
  ADD CONSTRAINT owl_center_launches_seller_fee_bps_check
  CHECK (seller_fee_basis_points >= 0 AND seller_fee_basis_points <= 10000);

COMMENT ON COLUMN public.owl_center_launches.seller_fee_basis_points IS
  'Secondary sale royalty in basis points (500 = 5%). Editable until candy_machine_id is set; baked into CM + each minted NFT at deploy.';
