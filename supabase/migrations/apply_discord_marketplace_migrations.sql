-- Combined Discord marketplace migrations (191–194)
-- Safe to run once on production via Supabase SQL Editor or:
--   npm run db:apply-discord-marketplace
-- (requires DATABASE_URL or SUPABASE_DB_URL in .env.local)

-- ============================================================================
-- Migration 191: points shop + balances + orders
-- ============================================================================

CREATE TABLE IF NOT EXISTS discord_marketplace_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_guild_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  points_cost BIGINT NOT NULL CHECK (points_cost > 0),
  owl_delivery_amount NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (owl_delivery_amount >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discord_guild_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_discord_marketplace_products_guild_active
  ON discord_marketplace_products (discord_guild_id, active, sort_order);

COMMENT ON TABLE discord_marketplace_products IS 'Per-guild shop SKUs. owl_delivery_amount is UI units sent on purchase when > 0.';

CREATE TABLE IF NOT EXISTS discord_marketplace_balances (
  discord_user_id TEXT NOT NULL,
  discord_guild_id TEXT NOT NULL,
  points_balance BIGINT NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (discord_user_id, discord_guild_id)
);

COMMENT ON TABLE discord_marketplace_balances IS 'Spendable points per Discord user per guild (grant via admin command or future earn flows).';

DO $$ BEGIN
  CREATE TYPE discord_marketplace_order_status AS ENUM (
    'pending_fulfillment',
    'fulfilled',
    'fulfillment_failed',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS discord_marketplace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_user_id TEXT NOT NULL,
  discord_guild_id TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES discord_marketplace_products (id),
  product_name TEXT NOT NULL,
  points_spent BIGINT NOT NULL CHECK (points_spent > 0),
  owl_delivery_amount NUMERIC(20, 6) NOT NULL DEFAULT 0,
  recipient_wallet TEXT,
  status discord_marketplace_order_status NOT NULL DEFAULT 'pending_fulfillment',
  fulfillment_tx_signature TEXT,
  fulfillment_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_discord_marketplace_orders_user
  ON discord_marketplace_orders (discord_user_id, discord_guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discord_marketplace_orders_status
  ON discord_marketplace_orders (status)
  WHERE status = 'pending_fulfillment';

ALTER TABLE discord_marketplace_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_marketplace_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_marketplace_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access discord_marketplace_products" ON discord_marketplace_products;
CREATE POLICY "Service role full access discord_marketplace_products"
  ON discord_marketplace_products FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access discord_marketplace_balances" ON discord_marketplace_balances;
CREATE POLICY "Service role full access discord_marketplace_balances"
  ON discord_marketplace_balances FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access discord_marketplace_orders" ON discord_marketplace_orders;
CREATE POLICY "Service role full access discord_marketplace_orders"
  ON discord_marketplace_orders FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.discord_marketplace_create_order(
  p_discord_user_id TEXT,
  p_discord_guild_id TEXT,
  p_product_id UUID,
  p_recipient_wallet TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_product discord_marketplace_products%ROWTYPE;
  v_balance BIGINT;
  v_order_id UUID;
BEGIN
  SELECT * INTO v_product
  FROM discord_marketplace_products
  WHERE id = p_product_id
    AND discord_guild_id = trim(p_discord_guild_id)
    AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  INSERT INTO discord_marketplace_balances (discord_user_id, discord_guild_id, points_balance)
  VALUES (trim(p_discord_user_id), trim(p_discord_guild_id), 0)
  ON CONFLICT (discord_user_id, discord_guild_id) DO NOTHING;

  SELECT points_balance INTO v_balance
  FROM discord_marketplace_balances
  WHERE discord_user_id = trim(p_discord_user_id)
    AND discord_guild_id = trim(p_discord_guild_id)
  FOR UPDATE;

  IF v_balance < v_product.points_cost THEN
    RAISE EXCEPTION 'insufficient_points';
  END IF;

  UPDATE discord_marketplace_balances
  SET points_balance = points_balance - v_product.points_cost,
      updated_at = now()
  WHERE discord_user_id = trim(p_discord_user_id)
    AND discord_guild_id = trim(p_discord_guild_id);

  INSERT INTO discord_marketplace_orders (
    discord_user_id,
    discord_guild_id,
    product_id,
    product_name,
    points_spent,
    owl_delivery_amount,
    recipient_wallet,
    status
  ) VALUES (
    trim(p_discord_user_id),
    trim(p_discord_guild_id),
    v_product.id,
    v_product.name,
    v_product.points_cost,
    v_product.owl_delivery_amount,
    nullif(trim(p_recipient_wallet), ''),
    'pending_fulfillment'
  )
  RETURNING id INTO v_order_id;

  RETURN json_build_object(
    'order_id', v_order_id,
    'product_name', v_product.name,
    'points_spent', v_product.points_cost,
    'owl_delivery_amount', v_product.owl_delivery_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.discord_marketplace_refund_order(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order discord_marketplace_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order
  FROM discord_marketplace_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_order.status NOT IN ('pending_fulfillment', 'fulfillment_failed') THEN
    RAISE EXCEPTION 'order_not_refundable';
  END IF;

  INSERT INTO discord_marketplace_balances (discord_user_id, discord_guild_id, points_balance)
  VALUES (v_order.discord_user_id, v_order.discord_guild_id, 0)
  ON CONFLICT (discord_user_id, discord_guild_id) DO NOTHING;

  UPDATE discord_marketplace_balances
  SET points_balance = points_balance + v_order.points_spent,
      updated_at = now()
  WHERE discord_user_id = v_order.discord_user_id
    AND discord_guild_id = v_order.discord_guild_id;

  UPDATE discord_marketplace_orders
  SET status = 'refunded'
  WHERE id = p_order_id;

  RETURN json_build_object('order_id', p_order_id, 'refunded_points', v_order.points_spent);
END;
$$;

-- ============================================================================
-- Migration 192: NFT listings + purchase intents
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE discord_marketplace_nft_currency AS ENUM ('SOL', 'OWL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE discord_marketplace_nft_listing_status AS ENUM (
    'pending_deposit',
    'available',
    'sold',
    'fulfillment_failed',
    'removed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS discord_marketplace_nft_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_guild_id TEXT NOT NULL,
  listing_slug TEXT NOT NULL,
  nft_mint TEXT NOT NULL,
  display_name TEXT,
  price_amount NUMERIC(20, 9) NOT NULL CHECK (price_amount > 0),
  currency discord_marketplace_nft_currency NOT NULL,
  status discord_marketplace_nft_listing_status NOT NULL DEFAULT 'pending_deposit',
  deposit_tx_signature TEXT,
  listed_by_discord_user_id TEXT,
  buyer_discord_user_id TEXT,
  buyer_wallet TEXT,
  payment_tx_signature TEXT,
  fulfillment_tx_signature TEXT,
  fulfillment_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sold_at TIMESTAMPTZ,
  UNIQUE (discord_guild_id, listing_slug)
);

CREATE INDEX IF NOT EXISTS idx_discord_marketplace_nft_listings_guild_status
  ON discord_marketplace_nft_listings (discord_guild_id, status);

CREATE INDEX IF NOT EXISTS idx_discord_marketplace_nft_listings_mint
  ON discord_marketplace_nft_listings (nft_mint);

COMMENT ON TABLE discord_marketplace_nft_listings IS 'NFTs held in prize/marketplace escrow; priced in SOL or OWL for Discord shop.';

DO $$ BEGIN
  CREATE TYPE discord_marketplace_nft_intent_status AS ENUM (
    'pending',
    'confirmed',
    'expired',
    'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS discord_marketplace_nft_purchase_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code TEXT NOT NULL UNIQUE,
  listing_id UUID NOT NULL REFERENCES discord_marketplace_nft_listings (id),
  discord_user_id TEXT NOT NULL,
  buyer_wallet TEXT NOT NULL,
  price_amount NUMERIC(20, 9) NOT NULL,
  currency discord_marketplace_nft_currency NOT NULL,
  memo TEXT NOT NULL,
  status discord_marketplace_nft_intent_status NOT NULL DEFAULT 'pending',
  confirmed_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_marketplace_nft_intents_listing
  ON discord_marketplace_nft_purchase_intents (listing_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discord_marketplace_nft_payment_sig
  ON discord_marketplace_nft_listings (payment_tx_signature)
  WHERE payment_tx_signature IS NOT NULL;

ALTER TABLE discord_marketplace_nft_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_marketplace_nft_purchase_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access discord_marketplace_nft_listings" ON discord_marketplace_nft_listings;
CREATE POLICY "Service role full access discord_marketplace_nft_listings"
  ON discord_marketplace_nft_listings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access discord_marketplace_nft_purchase_intents" ON discord_marketplace_nft_purchase_intents;
CREATE POLICY "Service role full access discord_marketplace_nft_purchase_intents"
  ON discord_marketplace_nft_purchase_intents FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.discord_marketplace_complete_nft_sale(
  p_listing_id UUID,
  p_buyer_discord_user_id TEXT,
  p_buyer_wallet TEXT,
  p_payment_tx_signature TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_listing discord_marketplace_nft_listings%ROWTYPE;
BEGIN
  SELECT * INTO v_listing
  FROM discord_marketplace_nft_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found';
  END IF;

  IF v_listing.status <> 'available' THEN
    RAISE EXCEPTION 'listing_not_available';
  END IF;

  UPDATE discord_marketplace_nft_listings
  SET
    status = 'sold',
    buyer_discord_user_id = trim(p_buyer_discord_user_id),
    buyer_wallet = trim(p_buyer_wallet),
    payment_tx_signature = trim(p_payment_tx_signature),
    sold_at = now()
  WHERE id = p_listing_id;

  RETURN json_build_object(
    'listing_id', v_listing.id,
    'nft_mint', v_listing.nft_mint,
    'display_name', v_listing.display_name,
    'currency', v_listing.currency,
    'price_amount', v_listing.price_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.discord_marketplace_mark_nft_fulfillment(
  p_listing_id UUID,
  p_fulfillment_tx_signature TEXT,
  p_failed BOOLEAN DEFAULT false,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_failed THEN
    UPDATE discord_marketplace_nft_listings
    SET
      status = 'fulfillment_failed',
      fulfillment_error = left(coalesce(p_error, 'fulfillment failed'), 500)
    WHERE id = p_listing_id;
  ELSE
    UPDATE discord_marketplace_nft_listings
    SET
      fulfillment_tx_signature = trim(p_fulfillment_tx_signature),
      fulfillment_error = NULL
    WHERE id = p_listing_id;
  END IF;
END;
$$;

-- ============================================================================
-- Migration 193: OWL token product kind
-- ============================================================================

ALTER TABLE discord_marketplace_products
  ADD COLUMN IF NOT EXISTS product_kind TEXT NOT NULL DEFAULT 'generic'
    CHECK (product_kind IN ('generic', 'owl_tokens'));

COMMENT ON COLUMN discord_marketplace_products.product_kind IS
  'owl_tokens = points-priced OWL bundle with on-chain SPL delivery; generic = other points items.';

CREATE INDEX IF NOT EXISTS idx_discord_marketplace_products_kind
  ON discord_marketplace_products (discord_guild_id, product_kind, active)
  WHERE active = true;

-- ============================================================================
-- Migration 194: unified shop_items
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE discord_marketplace_shop_deposit_kind AS ENUM (
    'none',
    'nft',
    'owl_spl'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE discord_marketplace_shop_price_currency AS ENUM ('POINTS', 'SOL', 'OWL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE discord_marketplace_shop_item_status AS ENUM (
    'pending_deposit',
    'available',
    'sold',
    'removed',
    'fulfillment_failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS discord_marketplace_shop_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_guild_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  deposit_kind discord_marketplace_shop_deposit_kind NOT NULL DEFAULT 'none',
  asset_mint TEXT,
  units_per_sale NUMERIC(20, 9) NOT NULL DEFAULT 1 CHECK (units_per_sale > 0),
  price_amount NUMERIC(20, 9) NOT NULL CHECK (price_amount > 0),
  price_currency discord_marketplace_shop_price_currency NOT NULL,
  treasury_funded BOOLEAN NOT NULL DEFAULT false,
  status discord_marketplace_shop_item_status NOT NULL DEFAULT 'pending_deposit',
  deposit_tx_signature TEXT,
  listed_by_wallet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discord_guild_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_discord_marketplace_shop_items_guild_status
  ON discord_marketplace_shop_items (discord_guild_id, status);

COMMENT ON TABLE discord_marketplace_shop_items IS
  'Unified admin shop listings. deposit_kind nft|owl_spl → deposit to DISCORD_MARKETPLACE_ESCROW; treasury_funded true → OWL sent from treasury on points purchase.';

COMMENT ON COLUMN discord_marketplace_shop_items.treasury_funded IS
  'When true (owl + points), OWL is delivered from DISCORD_MARKETPLACE_OWL_TREASURY without escrow deposit.';

ALTER TABLE discord_marketplace_shop_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access discord_marketplace_shop_items" ON discord_marketplace_shop_items;
CREATE POLICY "Service role full access discord_marketplace_shop_items"
  ON discord_marketplace_shop_items FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE discord_marketplace_nft_purchase_intents
  ADD COLUMN IF NOT EXISTS shop_item_id UUID REFERENCES discord_marketplace_shop_items (id);

ALTER TABLE discord_marketplace_nft_purchase_intents
  ALTER COLUMN listing_id DROP NOT NULL;
