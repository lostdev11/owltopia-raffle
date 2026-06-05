-- Owl Center: public_simple mint mode for partner/demo collections (PUBLIC phase only).
-- Gen2 keeps mint_mode = gen2_full (default).

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS mint_mode text NOT NULL DEFAULT 'gen2_full',
  ADD COLUMN IF NOT EXISTS mint_network text;

ALTER TABLE public.owl_center_launches
  DROP CONSTRAINT IF EXISTS owl_center_launches_mint_mode_check;

ALTER TABLE public.owl_center_launches
  ADD CONSTRAINT owl_center_launches_mint_mode_check
  CHECK (mint_mode IN ('gen2_full', 'public_simple'));

ALTER TABLE public.owl_center_launches
  DROP CONSTRAINT IF EXISTS owl_center_launches_mint_network_check;

ALTER TABLE public.owl_center_launches
  ADD CONSTRAINT owl_center_launches_mint_network_check
  CHECK (mint_network IS NULL OR mint_network IN ('devnet', 'mainnet'));

UPDATE public.owl_center_launches
SET mint_mode = 'gen2_full'
WHERE slug = 'gen2';

COMMENT ON COLUMN public.owl_center_launches.mint_mode IS
  'gen2_full = presale/WL/Gen1 phases; public_simple = PUBLIC-only Candy Machine mint for demo/partner collections.';
COMMENT ON COLUMN public.owl_center_launches.mint_network IS
  'Per-launch RPC cluster override (devnet|mainnet). NULL = follow NEXT_PUBLIC_GEN2_USE_DEVNET_MINT for gen2_full.';
