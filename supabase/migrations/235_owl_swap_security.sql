-- OwlSwap security hardening: settling status, unique deposit sigs, FORCE RLS.

ALTER TABLE public.owl_swap_offers
  DROP CONSTRAINT IF EXISTS owl_swap_offers_status_check;

ALTER TABLE public.owl_swap_offers
  ADD CONSTRAINT owl_swap_offers_status_check
  CHECK (status IN ('draft', 'open', 'settling', 'completed', 'cancelled', 'expired'));

-- One deposit signature may open/accept at most one offer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_owl_swap_offers_maker_deposit_sig_unique
  ON public.owl_swap_offers (maker_deposit_sig)
  WHERE maker_deposit_sig IS NOT NULL AND maker_deposit_sig <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_owl_swap_offers_taker_deposit_sig_unique
  ON public.owl_swap_offers (taker_deposit_sig)
  WHERE taker_deposit_sig IS NOT NULL AND taker_deposit_sig <> '';

-- Help mint exclusivity lookups across active offers.
CREATE INDEX IF NOT EXISTS idx_owl_swap_offer_assets_mint
  ON public.owl_swap_offer_assets (mint);

ALTER TABLE public.owl_swap_offers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.owl_swap_offer_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.owl_swap_ledger FORCE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.owl_swap_offers.status IS
  'draft|open|settling|completed|cancelled|expired. settling = accept claimed before settle lands.';
