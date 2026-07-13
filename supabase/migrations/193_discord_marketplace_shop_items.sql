-- Unified Discord shop items (admin dashboard) with dedicated marketplace escrow deposits.

CREATE TYPE discord_marketplace_shop_deposit_kind AS ENUM (
  'none',
  'nft',
  'owl_spl'
);

CREATE TYPE discord_marketplace_shop_price_currency AS ENUM ('POINTS', 'SOL', 'OWL');

CREATE TYPE discord_marketplace_shop_item_status AS ENUM (
  'pending_deposit',
  'available',
  'sold',
  'removed',
  'fulfillment_failed'
);

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

CREATE POLICY "Service role full access discord_marketplace_shop_items"
  ON discord_marketplace_shop_items FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE discord_marketplace_nft_purchase_intents
  ADD COLUMN IF NOT EXISTS shop_item_id UUID REFERENCES discord_marketplace_shop_items (id);

ALTER TABLE discord_marketplace_nft_purchase_intents
  ALTER COLUMN listing_id DROP NOT NULL;
