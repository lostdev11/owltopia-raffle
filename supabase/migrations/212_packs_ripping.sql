-- Packs ripping: products, vault config, NFT inventory, opens, ticket credits.

CREATE TABLE IF NOT EXISTS public.pack_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  price_sol numeric(18, 9) NOT NULL CHECK (price_sol > 0),
  rtp_bps integer NOT NULL DEFAULT 8000 CHECK (rtp_bps > 0 AND rtp_bps <= 10000),
  category_owl_bps integer NOT NULL DEFAULT 6000 CHECK (category_owl_bps >= 0),
  category_sol_bps integer NOT NULL DEFAULT 2000 CHECK (category_sol_bps >= 0),
  category_nft_bps integer NOT NULL DEFAULT 2000 CHECK (category_nft_bps >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pack_products_category_bps_sum CHECK (
    category_owl_bps + category_sol_bps + category_nft_bps = 10000
  )
);

COMMENT ON TABLE public.pack_products IS 'Purchasable pack SKUs for packs ripping.';

INSERT INTO public.pack_products (
  slug, name, price_sol, rtp_bps, category_owl_bps, category_sol_bps, category_nft_bps, active
) VALUES (
  'owl-pack-v1', 'Owl Pack', 0.1, 8000, 6000, 2000, 2000, true
) ON CONFLICT (slug) DO NOTHING;

-- Singleton vault config (id = 1)
CREATE TABLE IF NOT EXISTS public.pack_vault_config (
  id integer PRIMARY KEY CHECK (id = 1),
  vault_pubkey text,
  paused boolean NOT NULL DEFAULT true,
  pause_reason text,
  min_owl_balance numeric(28, 9) NOT NULL DEFAULT 100,
  min_sol_balance numeric(18, 9) NOT NULL DEFAULT 1,
  min_nft_count integer NOT NULL DEFAULT 1,
  owl_sol_price numeric(18, 12),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.pack_vault_config (id, paused, pause_reason)
VALUES (1, true, 'Fund vault and unpause when inventory is ready')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.pack_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'nft' CHECK (kind = 'nft'),
  mint_address text NOT NULL,
  name text,
  image_url text,
  fair_value_sol numeric(18, 9) NOT NULL
    CHECK (fair_value_sol >= 0.05 AND fair_value_sol <= 0.5),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'paid', 'removed')),
  reserved_open_id uuid,
  paid_open_id uuid,
  payout_signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pack_inventory_mint_available_uidx
  ON public.pack_inventory (mint_address)
  WHERE status IN ('available', 'reserved');

CREATE INDEX IF NOT EXISTS pack_inventory_status_fair_idx
  ON public.pack_inventory (status, fair_value_sol);

CREATE TABLE IF NOT EXISTS public.pack_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.pack_products (id),
  buyer_wallet text NOT NULL,
  payment_signature text,
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN (
      'pending_payment', 'paid', 'rolling', 'reserved', 'paying_out',
      'completed', 'failed', 'refund_needed'
    )),
  open_algo text NOT NULL DEFAULT 'owltopia-pack-open-v1',
  open_seed text,
  open_commit_hash text,
  category text CHECK (category IS NULL OR category IN ('owl', 'sol', 'nft')),
  prize_label text,
  owl_amount numeric(28, 9),
  sol_amount numeric(18, 9),
  nft_inventory_id uuid REFERENCES public.pack_inventory (id),
  nft_mint_address text,
  fair_value_sol numeric(18, 9),
  free_ticket_credits integer NOT NULL DEFAULT 0 CHECK (free_ticket_credits >= 0),
  payout_signature text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT pack_opens_payment_signature_unique UNIQUE (payment_signature)
);

CREATE INDEX IF NOT EXISTS pack_opens_buyer_created_idx
  ON public.pack_opens (buyer_wallet, created_at DESC);

CREATE INDEX IF NOT EXISTS pack_opens_status_created_idx
  ON public.pack_opens (status, created_at DESC);

CREATE INDEX IF NOT EXISTS pack_opens_completed_idx
  ON public.pack_opens (completed_at DESC)
  WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS public.pack_ticket_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet text NOT NULL,
  open_id uuid NOT NULL REFERENCES public.pack_opens (id),
  credits_granted integer NOT NULL CHECK (credits_granted > 0),
  credits_remaining integer NOT NULL CHECK (credits_remaining >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pack_ticket_credits_open_unique UNIQUE (open_id)
);

CREATE INDEX IF NOT EXISTS pack_ticket_credits_wallet_remaining_idx
  ON public.pack_ticket_credits (wallet)
  WHERE credits_remaining > 0;

CREATE TABLE IF NOT EXISTS public.pack_ticket_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet text NOT NULL,
  credit_id uuid NOT NULL REFERENCES public.pack_ticket_credits (id),
  raffle_id uuid NOT NULL,
  entry_id uuid,
  tickets integer NOT NULL CHECK (tickets > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pack_ticket_redemptions_wallet_idx
  ON public.pack_ticket_redemptions (wallet, created_at DESC);

-- RLS: service role only (Next.js APIs via getSupabaseAdmin)
ALTER TABLE public.pack_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pack_vault_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pack_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pack_opens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pack_ticket_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pack_ticket_redemptions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pack_products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pack_vault_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pack_inventory TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pack_opens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pack_ticket_credits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pack_ticket_redemptions TO service_role;
