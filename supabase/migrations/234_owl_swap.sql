-- OwlSwap P2P NFT swap offers + ledger (admin preview first).
-- Written by Next.js API via service role.

CREATE TABLE IF NOT EXISTS public.owl_swap_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code text NOT NULL,
  maker_wallet text NOT NULL,
  taker_wallet text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'completed', 'cancelled', 'expired')),
  maker_sol_lamports bigint NOT NULL DEFAULT 0 CHECK (maker_sol_lamports >= 0),
  taker_sol_lamports bigint NOT NULL DEFAULT 0 CHECK (taker_sol_lamports >= 0),
  owl_fee_lamports bigint,
  fee_discount_bps integer NOT NULL DEFAULT 0,
  maker_deposit_sig text,
  taker_deposit_sig text,
  settle_sig text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT owl_swap_offers_short_code_unique UNIQUE (short_code)
);

CREATE INDEX IF NOT EXISTS idx_owl_swap_offers_maker_created
  ON public.owl_swap_offers (maker_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owl_swap_offers_status_expires
  ON public.owl_swap_offers (status, expires_at);

CREATE TABLE IF NOT EXISTS public.owl_swap_offer_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.owl_swap_offers(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('maker', 'taker')),
  asset_kind text NOT NULL DEFAULT 'spl_nft'
    CHECK (asset_kind IN ('spl_nft', 'pnft', 'cnft', 'core', 'spl_token')),
  mint text NOT NULL,
  amount bigint NOT NULL DEFAULT 1 CHECK (amount >= 1),
  name text,
  image_url text,
  collection text,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owl_swap_offer_assets_offer
  ON public.owl_swap_offer_assets (offer_id, side);

CREATE TABLE IF NOT EXISTS public.owl_swap_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid REFERENCES public.owl_swap_offers(id) ON DELETE SET NULL,
  short_code text,
  maker_wallet text NOT NULL,
  taker_wallet text NOT NULL,
  settle_sig text NOT NULL,
  owl_fee_lamports bigint,
  fee_discount_bps integer NOT NULL DEFAULT 0,
  maker_mint_count integer NOT NULL DEFAULT 0,
  taker_mint_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_swap_ledger_settle_sig_unique UNIQUE (settle_sig)
);

CREATE INDEX IF NOT EXISTS idx_owl_swap_ledger_maker_created
  ON public.owl_swap_ledger (maker_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owl_swap_ledger_taker_created
  ON public.owl_swap_ledger (taker_wallet, created_at DESC);

COMMENT ON TABLE public.owl_swap_offers IS
  'OwlSwap P2P offers. API + service role only.';
COMMENT ON TABLE public.owl_swap_ledger IS
  'OwlSwap completed swaps. API + service role only.';

ALTER TABLE public.owl_swap_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owl_swap_offer_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owl_swap_ledger ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_swap_offers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_swap_offer_assets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_swap_ledger TO service_role;
