-- Admin refund flow for Gen2 presale:
-- - records every refund in an append-only audit table
-- - deducts purchased_mints for the target wallet
-- - optionally ties refund to a purchase tx and marks that purchase row as refunded

CREATE TABLE IF NOT EXISTS gen2_presale_refund_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_wallet text NOT NULL,
  recipient_wallet text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  purchase_tx_signature text,
  refund_tx_signature text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gen2_presale_refund_audit_purchase_tx_unique UNIQUE (purchase_tx_signature)
);

CREATE INDEX IF NOT EXISTS idx_gen2_presale_refund_audit_created_at
  ON gen2_presale_refund_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen2_presale_refund_audit_recipient
  ON gen2_presale_refund_audit (recipient_wallet);
CREATE INDEX IF NOT EXISTS idx_gen2_presale_refund_audit_actor
  ON gen2_presale_refund_audit (actor_wallet);

ALTER TABLE gen2_presale_refund_audit ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE gen2_presale_refund_audit IS
  'Append-only log for Gen2 presale refunds; writes via service_role RPC only.';

CREATE OR REPLACE FUNCTION public.refund_gen2_presale_mints(
  p_actor_wallet text,
  p_recipient_wallet text,
  p_quantity int DEFAULT NULL,
  p_purchase_tx_signature text DEFAULT NULL,
  p_refund_tx_signature text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase_qty int;
  v_status text;
  v_purchased int;
  v_gifted int;
  v_used int;
  v_min_purchased int;
  v_max_refundable int;
  v_final_qty int;
BEGIN
  IF p_recipient_wallet IS NULL OR btrim(p_recipient_wallet) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_wallet');
  END IF;

  PERFORM pg_advisory_xact_lock(98273491);

  IF p_purchase_tx_signature IS NOT NULL AND btrim(p_purchase_tx_signature) <> '' THEN
    SELECT quantity, status
    INTO v_purchase_qty, v_status
    FROM gen2_presale_purchases
    WHERE tx_signature = p_purchase_tx_signature
      AND wallet = p_recipient_wallet;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'purchase_not_found');
    END IF;

    IF v_status = 'refunded' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_refunded');
    END IF;

    IF v_status <> 'confirmed' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'purchase_not_confirmed', 'status', v_status);
    END IF;

    IF p_quantity IS NOT NULL AND p_quantity <> v_purchase_qty THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'quantity_mismatch_for_purchase_tx',
        'purchase_quantity', v_purchase_qty,
        'requested_quantity', p_quantity
      );
    END IF;

    v_final_qty := v_purchase_qty;
  ELSE
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'bad_quantity');
    END IF;
    v_final_qty := p_quantity;
  END IF;

  SELECT purchased_mints, gifted_mints, used_mints
  INTO v_purchased, v_gifted, v_used
  FROM gen2_presale_balances
  WHERE wallet = p_recipient_wallet
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_not_found');
  END IF;

  -- Keep invariant: used_mints <= purchased_mints + gifted_mints
  v_min_purchased := GREATEST(0, v_used - v_gifted);
  v_max_refundable := GREATEST(0, v_purchased - v_min_purchased);

  IF v_final_qty > v_max_refundable THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'refund_exceeds_refundable_purchased_mints',
      'max_refundable', v_max_refundable,
      'requested_refund', v_final_qty,
      'purchased_mints', v_purchased,
      'gifted_mints', v_gifted,
      'used_mints', v_used
    );
  END IF;

  UPDATE gen2_presale_balances
  SET purchased_mints = purchased_mints - v_final_qty,
      updated_at = now()
  WHERE wallet = p_recipient_wallet;

  IF p_purchase_tx_signature IS NOT NULL AND btrim(p_purchase_tx_signature) <> '' THEN
    UPDATE gen2_presale_purchases
    SET status = 'refunded'
    WHERE tx_signature = p_purchase_tx_signature
      AND wallet = p_recipient_wallet;
  END IF;

  INSERT INTO gen2_presale_refund_audit (
    actor_wallet,
    recipient_wallet,
    quantity,
    purchase_tx_signature,
    refund_tx_signature,
    reason
  )
  VALUES (
    p_actor_wallet,
    p_recipient_wallet,
    v_final_qty,
    NULLIF(btrim(p_purchase_tx_signature), ''),
    NULLIF(btrim(p_refund_tx_signature), ''),
    NULLIF(btrim(p_reason), '')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_quantity', v_final_qty,
    'wallet', p_recipient_wallet,
    'purchase_tx_signature', NULLIF(btrim(p_purchase_tx_signature), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_gen2_presale_mints(text, text, int, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_gen2_presale_mints(text, text, int, text, text, text) TO service_role;
