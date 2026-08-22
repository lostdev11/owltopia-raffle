-- Packs Phase 2: Switchboard VRF audit fields + NFT pool snapshot for verify.

ALTER TABLE public.pack_opens
  ADD COLUMN IF NOT EXISTS open_vrf_provider text,
  ADD COLUMN IF NOT EXISTS open_vrf_status text,
  ADD COLUMN IF NOT EXISTS open_vrf_account text,
  ADD COLUMN IF NOT EXISTS open_vrf_request_tx text,
  ADD COLUMN IF NOT EXISTS open_vrf_fulfill_tx text,
  ADD COLUMN IF NOT EXISTS open_vrf_error text,
  ADD COLUMN IF NOT EXISTS nft_pool_snapshot jsonb;

COMMENT ON COLUMN public.pack_opens.open_vrf_provider IS
  'Randomness provider id when using owltopia-pack-open-v2-vrf, e.g. switchboard';
COMMENT ON COLUMN public.pack_opens.open_vrf_status IS
  'pending | failed | fulfilled — null when local commit–reveal (v1)';
COMMENT ON COLUMN public.pack_opens.open_vrf_account IS
  'Switchboard randomness account pubkey';
COMMENT ON COLUMN public.pack_opens.open_vrf_request_tx IS
  'VRF commit (request) transaction signature';
COMMENT ON COLUMN public.pack_opens.open_vrf_fulfill_tx IS
  'VRF reveal (fulfill) transaction signature';
COMMENT ON COLUMN public.pack_opens.open_vrf_error IS
  'Last VRF error for admin / refund UX';
COMMENT ON COLUMN public.pack_opens.nft_pool_snapshot IS
  'Sorted NFT inventory snapshot at roll time: [{id,mint,fair_value_sol,weight}, ...] for verify';

ALTER TABLE public.pack_opens
  DROP CONSTRAINT IF EXISTS pack_opens_open_vrf_status_check;
ALTER TABLE public.pack_opens
  ADD CONSTRAINT pack_opens_open_vrf_status_check
  CHECK (
    open_vrf_status IS NULL
    OR open_vrf_status IN ('pending', 'failed', 'fulfilled')
  );
