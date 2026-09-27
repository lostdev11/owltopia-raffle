-- Track repeated NFT payout failures so prizes can be quarantined instead of re-entering the pool.

ALTER TABLE public.pack_inventory
  ADD COLUMN IF NOT EXISTS payout_fail_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.pack_inventory
  DROP CONSTRAINT IF EXISTS pack_inventory_payout_fail_count_check;

ALTER TABLE public.pack_inventory
  ADD CONSTRAINT pack_inventory_payout_fail_count_check
  CHECK (payout_fail_count >= 0);

COMMENT ON COLUMN public.pack_inventory.payout_fail_count IS
  'Incremented when an NFT prize payout fails after reservation; >= 2 quarantines the item (status removed).';

ALTER TABLE public.pack_opens
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.pack_opens
SET updated_at = COALESCE(completed_at, created_at);

CREATE INDEX IF NOT EXISTS pack_opens_status_updated_idx
  ON public.pack_opens (status, updated_at);

COMMENT ON COLUMN public.pack_opens.updated_at IS
  'Last pack_open row mutation; used by pack-open-reconcile cron for stuck pipeline detection.';
