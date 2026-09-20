-- Owl Packs: $OWL checkout (20 OWL + ~$1 SOL fee) behind admin flag.

ALTER TABLE public.pack_public_settings
  ADD COLUMN IF NOT EXISTS owl_checkout_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pack_public_settings.owl_checkout_enabled IS
  'When true, /packs buyers may pay with 20 $OWL + ~$1 SOL fee to the packs vault.';

ALTER TABLE public.pack_opens
  ADD COLUMN IF NOT EXISTS payment_currency text NOT NULL DEFAULT 'SOL';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pack_opens_payment_currency_check'
  ) THEN
    ALTER TABLE public.pack_opens
      ADD CONSTRAINT pack_opens_payment_currency_check
      CHECK (payment_currency IN ('SOL', 'OWL'));
  END IF;
END $$;

ALTER TABLE public.pack_opens
  ADD COLUMN IF NOT EXISTS payment_owl_amount numeric(18, 9);

ALTER TABLE public.pack_opens
  ADD COLUMN IF NOT EXISTS payment_fee_sol numeric(18, 9);

COMMENT ON COLUMN public.pack_opens.payment_currency IS
  'Buyer payment path: SOL (pack price) or OWL (20 OWL + SOL fee).';
COMMENT ON COLUMN public.pack_opens.payment_owl_amount IS
  'Expected OWL amount paid to vault when payment_currency=OWL.';
COMMENT ON COLUMN public.pack_opens.payment_fee_sol IS
  'Expected SOL fee (USD notional converted) when payment_currency=OWL.';
