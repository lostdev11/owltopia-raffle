-- Gen2 mainnet launch: frozen snapshot of Owltopia Gen1 holder wallets.
--
-- Feeds /api/owl-center/gen2/wl-proof?phase=AIRDROP so the Candy Machine `gen1` guard
-- group can use an allowList (merkle) guard for the free Gen1 holder mint. Populated by
-- admins via /api/admin/owl-center/gen2/gen1-snapshot (CSV upload or on-chain DAS scan),
-- then FROZEN once the merkle root is set on-chain.
--
-- Live per-wallet eligibility (max_mintable) still uses the on-chain Gen1 holder check;
-- this table only gates the on-chain allowList proof.

CREATE TABLE IF NOT EXISTS gen2_gen1_airdrop_snapshot (
  wallet text PRIMARY KEY,
  gen1_nft_count int NOT NULL DEFAULT 1,
  -- 'chain' (DAS scan) or 'csv' (admin upload)
  source text NOT NULL DEFAULT 'csv',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gen2_gen1_snapshot_count_pos CHECK (gen1_nft_count > 0),
  CONSTRAINT gen2_gen1_snapshot_source CHECK (source IN ('chain', 'csv'))
);

ALTER TABLE gen2_gen1_airdrop_snapshot ENABLE ROW LEVEL SECURITY;

-- No client policies: reads/writes go through API routes using service_role only.
GRANT SELECT, INSERT, UPDATE, DELETE ON gen2_gen1_airdrop_snapshot TO service_role;
