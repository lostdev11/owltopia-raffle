-- Link additional Solana wallets to a primary wallet (SIWS proof from linked wallet).
-- Used for Gen2 presale + whitelist Discord eligibility across wallets. API-only (service_role).

CREATE TABLE IF NOT EXISTS wallet_links (
  primary_wallet text NOT NULL,
  linked_wallet text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (linked_wallet),
  CHECK (primary_wallet <> linked_wallet)
);

CREATE INDEX IF NOT EXISTS idx_wallet_links_primary_wallet
  ON wallet_links (primary_wallet);

COMMENT ON TABLE wallet_links IS 'Additional wallets verified by signature and grouped under primary_wallet for eligibility (e.g. Gen2 Discord).';

ALTER TABLE wallet_links ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.wallet_links TO service_role;
