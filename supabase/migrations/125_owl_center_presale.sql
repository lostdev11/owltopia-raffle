-- Owl Center presale utility: admin-provisioned tenant campaigns (Partner Pro plug-and-play).

CREATE TABLE IF NOT EXISTS public.owl_center_presale_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  display_name text NOT NULL,
  headline text,
  description text,
  treasury_wallet text NOT NULL,
  partner_wallet text,
  is_enabled boolean NOT NULL DEFAULT false,
  is_live boolean NOT NULL DEFAULT false,
  unit_price_usdc numeric NOT NULL DEFAULT 20,
  presale_supply int NOT NULL DEFAULT 100,
  max_spots_per_purchase int NOT NULL DEFAULT 5,
  max_credits_per_wallet int NOT NULL DEFAULT 20,
  theme_primary text NOT NULL DEFAULT '#00FF9C',
  theme_accent text NOT NULL DEFAULT '#00E58B',
  theme_background text NOT NULL DEFAULT '#0B0F12',
  theme_surface text NOT NULL DEFAULT '#151D24',
  theme_muted text NOT NULL DEFAULT '#A9CBB9',
  preview_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  updated_by_wallet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_presale_tenants_slug_unique UNIQUE (slug),
  CONSTRAINT owl_center_presale_tenants_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT owl_center_presale_tenants_supply_pos CHECK (presale_supply > 0),
  CONSTRAINT owl_center_presale_tenants_price_pos CHECK (unit_price_usdc > 0),
  CONSTRAINT owl_center_presale_tenants_max_purchase_pos CHECK (max_spots_per_purchase > 0),
  CONSTRAINT owl_center_presale_tenants_max_wallet_pos CHECK (max_credits_per_wallet > 0)
);

CREATE INDEX IF NOT EXISTS idx_owl_center_presale_tenants_enabled
  ON public.owl_center_presale_tenants (is_enabled, sort_order, slug);

CREATE TABLE IF NOT EXISTS public.owl_center_presale_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.owl_center_presale_tenants (id) ON DELETE CASCADE,
  wallet text NOT NULL,
  quantity int NOT NULL,
  unit_price_usdc numeric NOT NULL,
  sol_usd_price numeric NOT NULL,
  total_lamports bigint NOT NULL,
  treasury_lamports bigint NOT NULL,
  tx_signature text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_presale_purchases_quantity_pos CHECK (quantity > 0),
  CONSTRAINT owl_center_presale_purchases_status_check CHECK (status IN ('pending', 'confirmed', 'failed', 'refunded')),
  CONSTRAINT owl_center_presale_purchases_tx_signature_unique UNIQUE (tx_signature)
);

CREATE INDEX IF NOT EXISTS idx_owl_center_presale_purchases_tenant
  ON public.owl_center_presale_purchases (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owl_center_presale_purchases_wallet
  ON public.owl_center_presale_purchases (wallet);

CREATE TABLE IF NOT EXISTS public.owl_center_presale_balances (
  tenant_id uuid NOT NULL REFERENCES public.owl_center_presale_tenants (id) ON DELETE CASCADE,
  wallet text NOT NULL,
  purchased_mints int NOT NULL DEFAULT 0,
  gifted_mints int NOT NULL DEFAULT 0,
  used_mints int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, wallet),
  CONSTRAINT owl_center_presale_balances_purchased_nonneg CHECK (purchased_mints >= 0),
  CONSTRAINT owl_center_presale_balances_gifted_nonneg CHECK (gifted_mints >= 0),
  CONSTRAINT owl_center_presale_balances_used_nonneg CHECK (used_mints >= 0),
  CONSTRAINT owl_center_presale_balances_used_cap CHECK (used_mints <= purchased_mints + gifted_mints)
);

ALTER TABLE public.owl_center_presale_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owl_center_presale_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owl_center_presale_balances ENABLE ROW LEVEL SECURITY;

DROP VIEW IF EXISTS public.owl_center_presale_available_balances;

CREATE VIEW public.owl_center_presale_available_balances
WITH (security_invoker = true) AS
SELECT
  tenant_id,
  wallet,
  purchased_mints,
  gifted_mints,
  used_mints,
  (purchased_mints + gifted_mints - used_mints) AS available_mints
FROM public.owl_center_presale_balances;

CREATE OR REPLACE FUNCTION public.owl_center_presale_sold_confirmed_quantity(p_tenant_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(quantity), 0)::bigint
  FROM public.owl_center_presale_purchases
  WHERE tenant_id = p_tenant_id AND status = 'confirmed';
$$;

CREATE OR REPLACE FUNCTION public.confirm_owl_center_presale_purchase(
  p_tenant_id uuid,
  p_wallet text,
  p_quantity int,
  p_unit_price_usdc numeric,
  p_sol_usd_price numeric,
  p_total_lamports bigint,
  p_treasury_lamports bigint,
  p_tx_signature text,
  p_presale_supply int,
  p_max_credits_per_wallet int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sold bigint;
  v_existing int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text));

  IF NOT EXISTS (
    SELECT 1 FROM public.owl_center_presale_tenants
    WHERE id = p_tenant_id AND is_enabled = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant_disabled');
  END IF;

  IF EXISTS (SELECT 1 FROM public.owl_center_presale_purchases WHERE tx_signature = p_tx_signature) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_tx');
  END IF;

  SELECT COALESCE(purchased_mints, 0) + COALESCE(gifted_mints, 0) INTO v_existing
  FROM public.owl_center_presale_balances
  WHERE tenant_id = p_tenant_id AND wallet = p_wallet;

  IF COALESCE(v_existing, 0) + p_quantity > p_max_credits_per_wallet THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet_cap');
  END IF;

  SELECT public.owl_center_presale_sold_confirmed_quantity(p_tenant_id) INTO v_sold;

  IF v_sold + p_quantity > p_presale_supply THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sold_out');
  END IF;

  INSERT INTO public.owl_center_presale_purchases (
    tenant_id,
    wallet,
    quantity,
    unit_price_usdc,
    sol_usd_price,
    total_lamports,
    treasury_lamports,
    tx_signature,
    status
  ) VALUES (
    p_tenant_id,
    p_wallet,
    p_quantity,
    p_unit_price_usdc,
    p_sol_usd_price,
    p_total_lamports,
    p_treasury_lamports,
    p_tx_signature,
    'confirmed'
  );

  INSERT INTO public.owl_center_presale_balances (tenant_id, wallet, purchased_mints, updated_at)
  VALUES (p_tenant_id, p_wallet, p_quantity, now())
  ON CONFLICT (tenant_id, wallet) DO UPDATE SET
    purchased_mints = owl_center_presale_balances.purchased_mints + p_quantity,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.owl_center_presale_sold_confirmed_quantity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_owl_center_presale_purchase(uuid, text, int, numeric, numeric, bigint, bigint, text, int, int) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_presale_tenants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_presale_purchases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_presale_balances TO service_role;
GRANT SELECT ON public.owl_center_presale_available_balances TO service_role;

GRANT EXECUTE ON FUNCTION public.owl_center_presale_sold_confirmed_quantity(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_owl_center_presale_purchase(uuid, text, int, numeric, numeric, bigint, bigint, text, int, int) TO service_role;

COMMENT ON TABLE public.owl_center_presale_tenants IS
  'Owl Center presale campaigns — API + service role only; admins flip is_enabled / is_live.';
