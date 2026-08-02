-- OwlSend send ledger: append-only record of successful NFT/token sends.
-- Written by Next.js API via service role after on-chain confirm.

CREATE TABLE IF NOT EXISTS public.owl_send_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_wallet text NOT NULL,
  mode text NOT NULL
    CHECK (mode IN ('nft_one', 'nft_scatter', 'token_one', 'token_scatter')),
  asset_kind text NOT NULL
    CHECK (asset_kind IN ('nft', 'token')),
  tx_signature text NOT NULL,
  recipient_count integer NOT NULL CHECK (recipient_count >= 1),
  asset_count integer NOT NULL CHECK (asset_count >= 1),
  fee_lamports bigint,
  batch_index integer,
  -- Per-line detail: [{ recipient, mint?, name?, amount_raw?, decimals?, symbol? }]
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_send_ledger_tx_signature_unique UNIQUE (tx_signature)
);

COMMENT ON TABLE public.owl_send_ledger IS
  'OwlSend successful send ledger. API + service role only.';

CREATE INDEX IF NOT EXISTS idx_owl_send_ledger_from_created
  ON public.owl_send_ledger (from_wallet, created_at DESC);

ALTER TABLE public.owl_send_ledger ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies — Next.js + getSupabaseAdmin() only.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_send_ledger TO service_role;
