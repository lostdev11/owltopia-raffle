-- Reveal day: blind mint with scheduled bulk on-chain metadata reveal (public_simple).
-- API + service_role only — no anon/authenticated Data API access.

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS reveal_mode text
    CHECK (reveal_mode IS NULL OR reveal_mode IN ('standard', 'reveal_day')),
  ADD COLUMN IF NOT EXISTS reveal_status text NOT NULL DEFAULT 'disabled'
    CHECK (reveal_status IN ('disabled', 'draft', 'scheduled', 'running', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS reveal_at timestamptz,
  ADD COLUMN IF NOT EXISTS reveal_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reveal_payment_tx_signature text,
  ADD COLUMN IF NOT EXISTS placeholder_metadata_uri text,
  ADD COLUMN IF NOT EXISTS reveal_progress jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.owl_center_launches.reveal_mode IS 'standard = final metadata at mint; reveal_day = placeholder mint until scheduled reveal.';
COMMENT ON COLUMN public.owl_center_launches.reveal_status IS 'disabled until reveal_day enabled; scheduled when reveal_at is set; running during bulk updateV1.';
COMMENT ON COLUMN public.owl_center_launches.placeholder_metadata_uri IS 'Arweave URI used on all CM config lines until reveal day.';
