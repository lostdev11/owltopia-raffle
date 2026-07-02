-- Gen2 PRESALE "switch wallet for mint" delegations.
--
-- Maps a presale credit holder's wallet (source_wallet, paid during presale) to a different
-- mint_wallet so the holder can redeem presale credits from a safe wallet WITHOUT moving
-- purchase records off the compromised wallet.
--
-- Honored by:
-- - live eligibility (lib/owl-center/gen2-presale-delegation.ts): mint_wallet is credited
--   with the source_wallet's gen2_presale_balances row; source_wallet is blocked.
-- - merkle allowlist (lib/gen2-presale/db.ts applyPresaleDelegations): the presale merkle
--   list substitutes source_wallet → mint_wallet for wl-proof / on-chain guard updates.
--
-- API + service role only (managed via /api/admin/owl-center/gen2/presale-delegations).

CREATE TABLE IF NOT EXISTS public.gen2_presale_mint_delegations (
  source_wallet text PRIMARY KEY,
  mint_wallet text NOT NULL UNIQUE,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gen2_presale_delegation_distinct CHECK (source_wallet <> mint_wallet)
);

CREATE INDEX IF NOT EXISTS gen2_presale_mint_delegations_mint_wallet_idx
  ON public.gen2_presale_mint_delegations (mint_wallet);

ALTER TABLE public.gen2_presale_mint_delegations ENABLE ROW LEVEL SECURITY;

-- API + service role only — no client policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gen2_presale_mint_delegations TO service_role;
