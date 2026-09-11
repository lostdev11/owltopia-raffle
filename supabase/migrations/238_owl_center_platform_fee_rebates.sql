-- Partner platform mint-fee rebate (e.g. Savi3 / Loud Lords: 20% of ~$1 fee).
-- Accrued locked on each confirmed mint; released after mint ends or via admin override.
-- No public status UI — ledger is admin/ops only.

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS platform_fee_rebate_bps integer NOT NULL DEFAULT 0
    CHECK (platform_fee_rebate_bps >= 0 AND platform_fee_rebate_bps <= 10000);

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS platform_fee_rebate_wallet text NULL;

COMMENT ON COLUMN public.owl_center_launches.platform_fee_rebate_bps IS
  'Share of Owltopia platform mint fee (~$1 SOL) owed to partner, in basis points (2000 = 20%). 0 = disabled.';

COMMENT ON COLUMN public.owl_center_launches.platform_fee_rebate_wallet IS
  'Partner Solana wallet that receives platform_fee_rebate_bps of platform mint fees after mint ends (or admin release).';

CREATE TABLE IF NOT EXISTS public.owl_center_platform_fee_rebates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES public.owl_center_launches (id) ON DELETE CASCADE,
  mint_tx_signature text NOT NULL,
  minter_wallet text NOT NULL,
  fee_lamports bigint NOT NULL CHECK (fee_lamports >= 0),
  rebate_lamports bigint NOT NULL CHECK (rebate_lamports >= 0),
  rebate_bps integer NOT NULL CHECK (rebate_bps >= 0 AND rebate_bps <= 10000),
  rebate_wallet text NOT NULL,
  state text NOT NULL DEFAULT 'locked'
    CHECK (state IN ('locked', 'releasable', 'released', 'forfeited')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  release_tx_signature text NULL,
  admin_wallet text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz NULL,
  CONSTRAINT owl_center_platform_fee_rebates_tx_unique UNIQUE (mint_tx_signature)
);

CREATE INDEX IF NOT EXISTS idx_owl_center_platform_fee_rebates_launch_state
  ON public.owl_center_platform_fee_rebates (launch_id, state);

CREATE INDEX IF NOT EXISTS idx_owl_center_platform_fee_rebates_created
  ON public.owl_center_platform_fee_rebates (created_at DESC);

COMMENT ON TABLE public.owl_center_platform_fee_rebates IS
  'Internal ledger: 20% (or configured bps) of platform mint fee locked during mint, released to partner wallet after sellout/admin.';

ALTER TABLE public.owl_center_platform_fee_rebates ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.owl_center_launches.partner_allowlist_phases IS
  'Ordered partner allowlist phases [{key,label,starts_at,supply,price_usdc,price_sol?,wallet_mint_limit?,redeem_token_mint?,redeem_token_amount?,redeem_mode?}] before PUBLIC. redeem_token_* = Free Mint Token burn (SPL) for that phase. Empty = legacy single WL via creator_wl_enabled / phase_schedule.WHITELIST.';
