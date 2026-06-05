-- Owl Center V1: launches, mint events, WL allocations, activity logs, creator submissions, atomic confirm RPC.

-- ---------------------------------------------------------------------------
-- Launches (flagship Gen2 + future collections)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owl_center_launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  symbol text,
  description text,
  image_url text,
  creator_wallet text,
  candy_machine_id text,
  collection_mint text,
  mint_standard text NOT NULL DEFAULT 'token_metadata',
  total_supply int NOT NULL,
  minted_count int NOT NULL DEFAULT 0,
  active_phase text NOT NULL DEFAULT 'PRESALE',
  status text NOT NULL DEFAULT 'PRESALE',
  presale_supply int NOT NULL DEFAULT 0,
  wl_supply int NOT NULL DEFAULT 0,
  public_supply int NOT NULL DEFAULT 0,
  airdrop_supply int NOT NULL DEFAULT 0,
  presale_price_usdc numeric,
  wl_price_usdc numeric,
  public_price_usdc numeric,
  wallet_mint_limit int NOT NULL DEFAULT 1,
  magic_eden_url text,
  tensor_url text,
  is_featured boolean NOT NULL DEFAULT false,
  is_paused boolean NOT NULL DEFAULT false,
  launch_deadline_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_launches_supply_pos CHECK (total_supply > 0),
  CONSTRAINT owl_center_launches_minted_nonneg CHECK (minted_count >= 0),
  CONSTRAINT owl_center_launches_minted_cap CHECK (minted_count <= total_supply),
  CONSTRAINT owl_center_launches_phase_check CHECK (
    active_phase IN ('AIRDROP', 'PRESALE', 'WHITELIST', 'PUBLIC', 'SOLD_OUT', 'TRADING_ACTIVE')
  ),
  CONSTRAINT owl_center_launches_status_check CHECK (
    status IN ('DRAFT', 'PENDING_REVIEW', 'PRESALE', 'WHITELIST', 'PUBLIC', 'SOLD_OUT', 'TRADING_ACTIVE')
  )
);

CREATE INDEX IF NOT EXISTS idx_owl_center_launches_slug ON owl_center_launches (slug);
CREATE INDEX IF NOT EXISTS idx_owl_center_launches_status ON owl_center_launches (status);
CREATE INDEX IF NOT EXISTS idx_owl_center_launches_featured ON owl_center_launches (is_featured) WHERE is_featured = true;

-- ---------------------------------------------------------------------------
-- Mint events (audit trail; tx_signature unique)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owl_center_mint_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES owl_center_launches(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  quantity int NOT NULL,
  tx_signature text NOT NULL,
  phase text NOT NULL,
  candy_machine_id text,
  minted_nft_mints text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_mint_events_quantity_pos CHECK (quantity > 0),
  CONSTRAINT owl_center_mint_events_phase_check CHECK (
    phase IN ('AIRDROP', 'PRESALE', 'WHITELIST', 'PUBLIC', 'SOLD_OUT', 'TRADING_ACTIVE')
  ),
  CONSTRAINT owl_center_mint_events_tx_unique UNIQUE (tx_signature)
);

CREATE INDEX IF NOT EXISTS idx_owl_center_mint_events_launch ON owl_center_mint_events (launch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owl_center_mint_events_wallet ON owl_center_mint_events (wallet_address);

-- ---------------------------------------------------------------------------
-- Whitelist allocations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owl_center_wl_allocations (
  wallet text PRIMARY KEY,
  allowed_mints int NOT NULL DEFAULT 0,
  used_mints int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_wl_allowed_nonneg CHECK (allowed_mints >= 0),
  CONSTRAINT owl_center_wl_used_nonneg CHECK (used_mints >= 0),
  CONSTRAINT owl_center_wl_used_cap CHECK (used_mints <= allowed_mints)
);

-- ---------------------------------------------------------------------------
-- Activity log (terminal feed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owl_center_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES owl_center_launches(id) ON DELETE CASCADE,
  message text NOT NULL,
  event_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owl_center_activity_launch ON owl_center_activity_logs (launch_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Creator submissions (future review queue — not mixed with live launches)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owl_center_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_name text NOT NULL,
  symbol text NOT NULL,
  description text,
  image_url text,
  total_supply int NOT NULL,
  mint_price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'SOL',
  wallet_mint_limit int NOT NULL DEFAULT 1,
  launch_date timestamptz,
  creator_wallet text NOT NULL,
  treasury_wallet text,
  magic_eden_url text,
  tensor_url text,
  status text NOT NULL DEFAULT 'PENDING_REVIEW',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_submissions_status CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  CONSTRAINT owl_center_submissions_currency CHECK (currency IN ('SOL', 'USDC')),
  CONSTRAINT owl_center_submissions_supply_pos CHECK (total_supply > 0)
);

CREATE INDEX IF NOT EXISTS idx_owl_center_submissions_status ON owl_center_submissions (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE owl_center_launches ENABLE ROW LEVEL SECURITY;
ALTER TABLE owl_center_mint_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE owl_center_wl_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE owl_center_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owl_center_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read non-draft owl center launches" ON owl_center_launches;
CREATE POLICY "Public read non-draft owl center launches"
  ON owl_center_launches
  FOR SELECT
  USING (status NOT IN ('DRAFT', 'PENDING_REVIEW'));

-- No direct client reads on mint/WL/logs/submissions (API uses service_role).

-- ---------------------------------------------------------------------------
-- Atomic confirm after server verifies Solana tx
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_owl_center_gen2_mint(
  p_launch_slug text,
  p_wallet text,
  p_tx_signature text,
  p_quantity int,
  p_phase text,
  p_minted_nft_mints text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_launch owl_center_launches%ROWTYPE;
  v_launch_id uuid;
  v_public_minted int;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  END IF;

  IF p_phase NOT IN ('AIRDROP', 'PRESALE', 'WHITELIST', 'PUBLIC', 'SOLD_OUT', 'TRADING_ACTIVE') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_phase');
  END IF;

  PERFORM pg_advisory_xact_lock(98273492, hashtext('owl_center:' || p_launch_slug));

  SELECT * INTO v_launch FROM owl_center_launches WHERE slug = p_launch_slug FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'launch_not_found');
  END IF;

  v_launch_id := v_launch.id;

  IF v_launch.is_paused THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mint_paused');
  END IF;

  IF v_launch.active_phase IN ('SOLD_OUT', 'TRADING_ACTIVE') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mint_closed');
  END IF;

  IF p_phase <> v_launch.active_phase THEN
    RETURN jsonb_build_object('ok', false, 'error', 'phase_mismatch');
  END IF;

  IF EXISTS (SELECT 1 FROM owl_center_mint_events WHERE tx_signature = p_tx_signature) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_tx');
  END IF;

  IF v_launch.minted_count + p_quantity > v_launch.total_supply THEN
    RETURN jsonb_build_object('ok', false, 'error', 'exceeds_supply');
  END IF;

  -- Phase-specific consumption / eligibility
  IF p_phase = 'PRESALE' THEN
    PERFORM public.use_gen2_presale_mints(p_wallet, p_quantity);
  ELSIF p_phase = 'WHITELIST' THEN
    UPDATE owl_center_wl_allocations
    SET used_mints = used_mints + p_quantity,
        updated_at = now()
    WHERE wallet = p_wallet
      AND (allowed_mints - used_mints) >= p_quantity;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_wl_allocation');
    END IF;
  ELSIF p_phase = 'PUBLIC' THEN
    SELECT COALESCE(SUM(quantity), 0)::int INTO v_public_minted
    FROM owl_center_mint_events
    WHERE launch_id = v_launch_id AND wallet_address = p_wallet AND phase = 'PUBLIC';
    IF v_public_minted + p_quantity > v_launch.wallet_mint_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wallet_mint_limit');
    END IF;
  ELSIF p_phase = 'AIRDROP' THEN
    SELECT COALESCE(SUM(quantity), 0)::int INTO v_public_minted
    FROM owl_center_mint_events
    WHERE launch_id = v_launch_id AND wallet_address = p_wallet AND phase = 'AIRDROP';
    IF v_public_minted + p_quantity > v_launch.wallet_mint_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wallet_mint_limit');
    END IF;
  END IF;

  INSERT INTO owl_center_mint_events (
    launch_id,
    wallet_address,
    quantity,
    tx_signature,
    phase,
    candy_machine_id,
    minted_nft_mints
  ) VALUES (
    v_launch_id,
    p_wallet,
    p_quantity,
    p_tx_signature,
    p_phase,
    v_launch.candy_machine_id,
    p_minted_nft_mints
  );

  UPDATE owl_center_launches
  SET
    minted_count = minted_count + p_quantity,
    updated_at = now(),
    active_phase = CASE
      WHEN minted_count + p_quantity >= total_supply THEN 'SOLD_OUT'::text
      ELSE active_phase
    END,
    status = CASE
      WHEN minted_count + p_quantity >= total_supply THEN 'SOLD_OUT'::text
      ELSE status
    END
  WHERE id = v_launch_id;

  INSERT INTO owl_center_activity_logs (launch_id, message, event_type)
  VALUES (
    v_launch_id,
    format('MINT_CONFIRMED wallet=%s qty=%s phase=%s tx=%s', p_wallet, p_quantity, p_phase, left(p_tx_signature, 16) || '…'),
    'mint'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'minted_count', (SELECT minted_count FROM owl_center_launches WHERE id = v_launch_id),
    'active_phase', (SELECT active_phase FROM owl_center_launches WHERE id = v_launch_id),
    'status', (SELECT status FROM owl_center_launches WHERE id = v_launch_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_owl_center_gen2_mint(text, text, text, int, text, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- Seed Owltopia Gen2 (June 27, 2026 deadline)
-- ---------------------------------------------------------------------------
INSERT INTO owl_center_launches (
  slug,
  name,
  symbol,
  description,
  image_url,
  mint_standard,
  total_supply,
  minted_count,
  active_phase,
  status,
  presale_supply,
  wl_supply,
  public_supply,
  airdrop_supply,
  presale_price_usdc,
  wl_price_usdc,
  public_price_usdc,
  wallet_mint_limit,
  is_featured,
  is_paused,
  candy_machine_id,
  collection_mint,
  magic_eden_url,
  tensor_url,
  launch_deadline_at,
  updated_at
)
VALUES (
  'gen2',
  'Owltopia Gen2',
  'OWLGEN2',
  'Owltopia Gen2 — flagship collection powered by Owl Center. Token Metadata NFTs via Candy Machine V3.',
  '/images/gen2-logo-mark.png',
  'token_metadata',
  2000,
  0,
  'PRESALE',
  'PRESALE',
  657,
  800,
  200,
  343,
  20,
  30,
  40,
  5,
  true,
  false,
  NULL,
  NULL,
  NULL,
  NULL,
  '2026-06-27T23:59:59Z',
  now()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  symbol = EXCLUDED.symbol,
  description = EXCLUDED.description,
  total_supply = EXCLUDED.total_supply,
  presale_supply = EXCLUDED.presale_supply,
  wl_supply = EXCLUDED.wl_supply,
  public_supply = EXCLUDED.public_supply,
  airdrop_supply = EXCLUDED.airdrop_supply,
  presale_price_usdc = EXCLUDED.presale_price_usdc,
  wl_price_usdc = EXCLUDED.wl_price_usdc,
  public_price_usdc = EXCLUDED.public_price_usdc,
  is_featured = EXCLUDED.is_featured,
  launch_deadline_at = EXCLUDED.launch_deadline_at,
  updated_at = now();

COMMENT ON TABLE owl_center_launches IS 'Owl Center launch registry; public SELECT excludes DRAFT/PENDING_REVIEW.';
COMMENT ON FUNCTION public.confirm_owl_center_gen2_mint IS 'Service-role only: record mint, bump supply, presale/WL debits; advisory locked per slug.';
