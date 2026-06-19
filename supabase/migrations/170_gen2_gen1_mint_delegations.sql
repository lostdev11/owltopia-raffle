-- Gen2 AIRDROP "switch wallet for mint" delegations.
--
-- Lets an admin map a Gen1 holder's wallet (source_wallet, holds the NFT) to a
-- different mint_wallet so the holder can claim their free Gen2 from another wallet
-- WITHOUT transferring the Gen1 NFT.
--
-- Honored by:
-- - live eligibility (lib/owl-center/gen2-mint-delegation.ts): mint_wallet is credited
--   with the source_wallet's live Gen1 count; source_wallet is blocked from minting.
-- - merkle snapshot (lib/db/gen2-gen1-delegations.ts applyGen1Delegations): the
--   gen2_gen1_airdrop_snapshot row for source_wallet is substituted with mint_wallet,
--   so /api/owl-center/gen2/wl-proof?phase=AIRDROP serves a proof for the mint wallet.
--
-- API + service role only (managed via /api/admin/owl-center/gen2/gen1-delegations).

CREATE TABLE IF NOT EXISTS public.gen2_gen1_mint_delegations (
  -- Wallet that holds the Gen1 NFT(s); blocked from minting once delegated away.
  source_wallet text PRIMARY KEY,
  -- Wallet that mints the free Gen2 on the holder's behalf (one delegation per mint wallet).
  mint_wallet text NOT NULL UNIQUE,
  note text,
  -- Admin wallet that created/updated the mapping (audit).
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gen2_gen1_delegation_distinct CHECK (source_wallet <> mint_wallet)
);

-- Fast reverse lookup (connected mint_wallet -> source_wallet).
CREATE INDEX IF NOT EXISTS gen2_gen1_mint_delegations_mint_wallet_idx
  ON public.gen2_gen1_mint_delegations (mint_wallet);

ALTER TABLE public.gen2_gen1_mint_delegations ENABLE ROW LEVEL SECURITY;

-- No client policies: reads/writes go through API routes using service_role only.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gen2_gen1_mint_delegations TO service_role;
