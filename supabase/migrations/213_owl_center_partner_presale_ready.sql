-- Partner-ready Owl Center presale: approval workflow, fee split columns, gift credits.

-- Approval + ownership
ALTER TABLE public.owl_center_presale_tenants
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS created_by_wallet text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.owl_center_presale_tenants
  DROP CONSTRAINT IF EXISTS owl_center_presale_tenants_approval_status_check;

ALTER TABLE public.owl_center_presale_tenants
  ADD CONSTRAINT owl_center_presale_tenants_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_owl_center_presale_tenants_created_by
  ON public.owl_center_presale_tenants (created_by_wallet)
  WHERE created_by_wallet IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_owl_center_presale_tenants_approval
  ON public.owl_center_presale_tenants (approval_status, created_at DESC);

COMMENT ON COLUMN public.owl_center_presale_tenants.approval_status IS
  'pending = partner submitted, awaiting Owltopia admin; approved = may enable/live; rejected = closed.';
COMMENT ON COLUMN public.owl_center_presale_tenants.created_by_wallet IS
  'Partner (or admin) wallet that created the campaign; used for self-serve ownership + gift auth.';

-- Purchase fee split (partner proceeds + Owltopia platform fee)
ALTER TABLE public.owl_center_presale_purchases
  ADD COLUMN IF NOT EXISTS partner_lamports bigint,
  ADD COLUMN IF NOT EXISTS platform_fee_lamports bigint;

COMMENT ON COLUMN public.owl_center_presale_purchases.partner_lamports IS
  'SOL lamports sent to partner receive wallet (spot price × qty).';
COMMENT ON COLUMN public.owl_center_presale_purchases.platform_fee_lamports IS
  'SOL lamports sent to Owltopia platform treasury (~$1 USDC-eq × qty).';
COMMENT ON COLUMN public.owl_center_presale_purchases.treasury_lamports IS
  'Legacy: historically all proceeds. New rows store partner_lamports here for compatibility.';

-- Gift audit + RPC
CREATE TABLE IF NOT EXISTS public.owl_center_presale_gift_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.owl_center_presale_tenants (id) ON DELETE CASCADE,
  actor_wallet text NOT NULL,
  recipient_wallet text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0 AND quantity <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owl_center_presale_gift_audit_tenant
  ON public.owl_center_presale_gift_audit (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owl_center_presale_gift_audit_recipient
  ON public.owl_center_presale_gift_audit (recipient_wallet);
CREATE INDEX IF NOT EXISTS idx_owl_center_presale_gift_audit_actor
  ON public.owl_center_presale_gift_audit (actor_wallet);

ALTER TABLE public.owl_center_presale_gift_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owl_center_presale_gift_audit_deny_all ON public.owl_center_presale_gift_audit;
CREATE POLICY owl_center_presale_gift_audit_deny_all
  ON public.owl_center_presale_gift_audit
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_presale_gift_audit TO service_role;

COMMENT ON TABLE public.owl_center_presale_gift_audit IS
  'Append-only log of partner/admin gifted mint credits; service_role only.';

CREATE OR REPLACE FUNCTION public.gift_owl_center_presale_mints(
  p_tenant_id uuid,
  p_actor_wallet text,
  p_recipient_wallet text,
  p_quantity int,
  p_max_credits_per_wallet int DEFAULT 20
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing int;
  v_cap int;
BEGIN
  IF p_quantity <= 0 OR p_quantity > 500 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 500';
  END IF;

  v_cap := GREATEST(1, LEAST(COALESCE(p_max_credits_per_wallet, 20), 500));

  SELECT COALESCE(purchased_mints, 0) + COALESCE(gifted_mints, 0)
  INTO v_existing
  FROM public.owl_center_presale_balances
  WHERE tenant_id = p_tenant_id AND wallet = p_recipient_wallet;

  v_existing := COALESCE(v_existing, 0);
  IF v_existing + p_quantity > v_cap THEN
    RAISE EXCEPTION 'owl_center_presale_wallet_cap_exceeded';
  END IF;

  INSERT INTO public.owl_center_presale_gift_audit (tenant_id, actor_wallet, recipient_wallet, quantity)
  VALUES (p_tenant_id, p_actor_wallet, p_recipient_wallet, p_quantity);

  INSERT INTO public.owl_center_presale_balances (tenant_id, wallet, gifted_mints, updated_at)
  VALUES (p_tenant_id, p_recipient_wallet, p_quantity, now())
  ON CONFLICT (tenant_id, wallet) DO UPDATE SET
    gifted_mints = owl_center_presale_balances.gifted_mints + p_quantity,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.gift_owl_center_presale_mints(uuid, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_owl_center_presale_mints(uuid, text, text, int, int) TO service_role;

-- Extend confirm RPC to accept optional partner/platform fee lamports.
DROP FUNCTION IF EXISTS public.confirm_owl_center_presale_purchase(
  uuid, text, int, numeric, numeric, bigint, bigint, text, int, int
);

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
  p_max_credits_per_wallet int,
  p_partner_lamports bigint DEFAULT NULL,
  p_platform_fee_lamports bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sold int;
  v_existing int;
  v_enabled boolean;
BEGIN
  SELECT is_enabled INTO v_enabled
  FROM public.owl_center_presale_tenants
  WHERE id = p_tenant_id;

  IF v_enabled IS DISTINCT FROM true THEN
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
    tenant_id, wallet, quantity, unit_price_usdc, sol_usd_price,
    total_lamports, treasury_lamports, partner_lamports, platform_fee_lamports,
    tx_signature, status
  ) VALUES (
    p_tenant_id, p_wallet, p_quantity, p_unit_price_usdc, p_sol_usd_price,
    p_total_lamports, p_treasury_lamports, p_partner_lamports, p_platform_fee_lamports,
    p_tx_signature, 'confirmed'
  );

  INSERT INTO public.owl_center_presale_balances (tenant_id, wallet, purchased_mints, updated_at)
  VALUES (p_tenant_id, p_wallet, p_quantity, now())
  ON CONFLICT (tenant_id, wallet) DO UPDATE SET
    purchased_mints = owl_center_presale_balances.purchased_mints + p_quantity,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_owl_center_presale_purchase(
  uuid, text, int, numeric, numeric, bigint, bigint, text, int, int, bigint, bigint
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_owl_center_presale_purchase(
  uuid, text, int, numeric, numeric, bigint, bigint, text, int, int, bigint, bigint
) TO service_role;
