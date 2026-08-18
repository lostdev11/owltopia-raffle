-- Packs inventory: store NFT standard so vault payout can use Core / compressed
-- transfers (raffle prize-escrow already supports these). Existing rows default to spl.
-- API + service role only (pack_inventory already granted to service_role in 212).

ALTER TABLE public.pack_inventory
  ADD COLUMN IF NOT EXISTS prize_standard text NOT NULL DEFAULT 'spl';

ALTER TABLE public.pack_inventory
  DROP CONSTRAINT IF EXISTS pack_inventory_prize_standard_check;

ALTER TABLE public.pack_inventory
  ADD CONSTRAINT pack_inventory_prize_standard_check
  CHECK (prize_standard IN ('spl', 'mpl_core', 'compressed'));

COMMENT ON COLUMN public.pack_inventory.prize_standard IS
  'NFT standard for vault payout: spl (classic ATA), mpl_core, or compressed. mint_address is the DAS / asset id for Core and cNFT. API + service role only.';
