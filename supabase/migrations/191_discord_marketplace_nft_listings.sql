-- Discord marketplace NFT listings: admin deposits NFTs to escrow, users buy with SOL or OWL.

CREATE TYPE discord_marketplace_nft_currency AS ENUM ('SOL', 'OWL');

CREATE TYPE discord_marketplace_nft_listing_status AS ENUM (
  'pending_deposit',
  'available',
  'sold',
  'fulfillment_failed',
  'removed'
);

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

CREATE TYPE discord_marketplace_nft_intent_status AS ENUM (
  'pending',
  'confirmed',
  'expired',
  'superseded'
);

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

CREATE POLICY "Service role full access discord_marketplace_nft_listings"
  ON discord_marketplace_nft_listings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access discord_marketplace_nft_purchase_intents"
  ON discord_marketplace_nft_purchase_intents FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Mark listing sold after verified payment (first confirm wins).
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
