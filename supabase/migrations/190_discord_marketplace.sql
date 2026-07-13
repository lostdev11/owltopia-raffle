-- Discord marketplace: points shop with automatic OWL SPL fulfillment to linked wallets.

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

CREATE TYPE discord_marketplace_order_status AS ENUM (
  'pending_fulfillment',
  'fulfilled',
  'fulfillment_failed',
  'refunded'
);

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

-- Service role only (Discord bot + admin APIs use getSupabaseAdmin).
CREATE POLICY "Service role full access discord_marketplace_products"
  ON discord_marketplace_products FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access discord_marketplace_balances"
  ON discord_marketplace_balances FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access discord_marketplace_orders"
  ON discord_marketplace_orders FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Atomically deduct points and create a pending order row.
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

-- Refund points when on-chain fulfillment fails after order creation.
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
