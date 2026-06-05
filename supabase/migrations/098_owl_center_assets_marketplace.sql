-- Owl Center: asset packages, marketplace readiness, launch readiness flags, RPC helpers.

-- ---------------------------------------------------------------------------
-- Launch columns (readiness + creator submission helpers)
-- ---------------------------------------------------------------------------
ALTER TABLE owl_center_launches
  ADD COLUMN IF NOT EXISTS metadata_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assets_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketplace_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS treasury_wallet text,
  ADD COLUMN IF NOT EXISTS creator_presale_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS creator_wl_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS creator_mint_price numeric,
  ADD COLUMN IF NOT EXISTS creator_mint_currency text NOT NULL DEFAULT 'SOL',
  ADD COLUMN IF NOT EXISTS creator_launch_date timestamptz;

ALTER TABLE owl_center_launches DROP CONSTRAINT IF EXISTS owl_center_launches_creator_mint_currency_check;
ALTER TABLE owl_center_launches
  ADD CONSTRAINT owl_center_launches_creator_mint_currency_check
  CHECK (creator_mint_currency IN ('SOL', 'USDC'));

COMMENT ON COLUMN owl_center_launches.metadata_ready IS 'NFT metadata package validated + uploaded per owl_center_asset_packages.';
COMMENT ON COLUMN owl_center_launches.assets_ready IS 'Image/asset package validated.';
COMMENT ON COLUMN owl_center_launches.marketplace_ready IS 'Magic Eden + Tensor paths verified (manual tracking).';

-- ---------------------------------------------------------------------------
-- Asset packages (one row per launch)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owl_center_asset_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES owl_center_launches(id) ON DELETE CASCADE,
  logo_url text,
  banner_url text,
  collection_image_url text,
  assets_storage_path text,
  metadata_storage_path text,
  traits_csv_url text,
  expected_supply int NOT NULL DEFAULT 0,
  total_images int NOT NULL DEFAULT 0,
  total_metadata int NOT NULL DEFAULT 0,
  validation_status text NOT NULL DEFAULT 'PENDING',
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_provider text NOT NULL DEFAULT 'pending',
  metadata_upload_status text NOT NULL DEFAULT 'NOT_UPLOADED',
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_asset_packages_launch_unique UNIQUE (launch_id),
  CONSTRAINT owl_center_asset_packages_validation_status_check CHECK (
    validation_status IN ('PENDING', 'VALID', 'INVALID', 'NEEDS_REVIEW')
  ),
  CONSTRAINT owl_center_asset_packages_metadata_upload_check CHECK (
    metadata_upload_status IN (
      'NOT_UPLOADED',
      'UPLOADING',
      'UPLOADED_TO_IPFS',
      'UPLOADED_TO_ARWEAVE',
      'READY_FOR_CANDY_MACHINE'
    )
  ),
  CONSTRAINT owl_center_asset_packages_counts_nonneg CHECK (
    expected_supply >= 0 AND total_images >= 0 AND total_metadata >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_owl_center_asset_packages_launch ON owl_center_asset_packages (launch_id);
CREATE INDEX IF NOT EXISTS idx_owl_center_asset_packages_validation ON owl_center_asset_packages (validation_status);
CREATE INDEX IF NOT EXISTS idx_owl_center_asset_packages_metadata_upload ON owl_center_asset_packages (metadata_upload_status);

-- ---------------------------------------------------------------------------
-- Marketplace readiness (one row per launch)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owl_center_marketplace_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES owl_center_launches(id) ON DELETE CASCADE,
  collection_mint text,
  candy_machine_id text,
  hash_list_url text,
  magic_eden_url text,
  tensor_url text,
  metadata_status text NOT NULL DEFAULT 'NOT_READY',
  verified_collection_status text NOT NULL DEFAULT 'NOT_READY',
  magic_eden_status text NOT NULL DEFAULT 'NOT_READY',
  tensor_status text NOT NULL DEFAULT 'NOT_READY',
  trading_links_active boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_marketplace_launch_unique UNIQUE (launch_id),
  CONSTRAINT owl_center_marketplace_meta_status_check CHECK (
    metadata_status IN (
      'NOT_READY',
      'READY_FOR_INDEXING',
      'INDEXING',
      'LISTED',
      'CLAIMED',
      'VERIFIED',
      'NEEDS_MANUAL_REVIEW'
    )
  ),
  CONSTRAINT owl_center_marketplace_verified_check CHECK (
    verified_collection_status IN (
      'NOT_READY',
      'READY_FOR_INDEXING',
      'INDEXING',
      'LISTED',
      'CLAIMED',
      'VERIFIED',
      'NEEDS_MANUAL_REVIEW'
    )
  ),
  CONSTRAINT owl_center_marketplace_me_check CHECK (
    magic_eden_status IN (
      'NOT_READY',
      'READY_FOR_INDEXING',
      'INDEXING',
      'LISTED',
      'CLAIMED',
      'VERIFIED',
      'NEEDS_MANUAL_REVIEW'
    )
  ),
  CONSTRAINT owl_center_marketplace_tensor_check CHECK (
    tensor_status IN (
      'NOT_READY',
      'READY_FOR_INDEXING',
      'INDEXING',
      'LISTED',
      'CLAIMED',
      'VERIFIED',
      'NEEDS_MANUAL_REVIEW'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_owl_center_marketplace_launch ON owl_center_marketplace_readiness (launch_id);
CREATE INDEX IF NOT EXISTS idx_owl_center_marketplace_me ON owl_center_marketplace_readiness (magic_eden_status);
CREATE INDEX IF NOT EXISTS idx_owl_center_marketplace_tensor ON owl_center_marketplace_readiness (tensor_status);
CREATE INDEX IF NOT EXISTS idx_owl_center_marketplace_trading ON owl_center_marketplace_readiness (trading_links_active);

-- ---------------------------------------------------------------------------
-- updated_at touch (shared helper from 019_fix_function_search_path.sql)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_owl_center_asset_packages_updated ON owl_center_asset_packages;
CREATE TRIGGER trg_owl_center_asset_packages_updated
  BEFORE UPDATE ON owl_center_asset_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_owl_center_marketplace_updated ON owl_center_marketplace_readiness;
CREATE TRIGGER trg_owl_center_marketplace_updated
  BEFORE UPDATE ON owl_center_marketplace_readiness
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RPC: asset package validation / metadata status → launch flags
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_asset_package_status(
  p_launch_id uuid,
  p_validation_status text,
  p_metadata_upload_status text,
  p_validation_errors jsonb DEFAULT '[]'::jsonb,
  p_validation_checklist jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE owl_center_asset_packages
  SET
    validation_status = p_validation_status,
    metadata_upload_status = p_metadata_upload_status,
    validation_errors = p_validation_errors,
    validation_checklist = p_validation_checklist,
    updated_at = now()
  WHERE launch_id = p_launch_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_validation_status = 'VALID' AND p_metadata_upload_status = 'READY_FOR_CANDY_MACHINE' THEN
    UPDATE owl_center_launches
    SET assets_ready = true, metadata_ready = true, updated_at = now()
    WHERE id = p_launch_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_asset_package_status(uuid, text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_asset_package_status(uuid, text, text, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: marketplace status + optional URLs → launch marketplace_ready + URL mirror
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_marketplace_readiness(
  p_launch_id uuid,
  p_magic_eden_status text,
  p_tensor_status text,
  p_magic_eden_url text DEFAULT NULL,
  p_tensor_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m owl_center_marketplace_readiness%ROWTYPE;
  v_me_ok boolean;
  v_te_ok boolean;
BEGIN
  UPDATE owl_center_marketplace_readiness
  SET
    magic_eden_status = p_magic_eden_status,
    tensor_status = p_tensor_status,
    magic_eden_url = CASE WHEN p_magic_eden_url IS NOT NULL THEN p_magic_eden_url ELSE magic_eden_url END,
    tensor_url = CASE WHEN p_tensor_url IS NOT NULL THEN p_tensor_url ELSE tensor_url END,
    updated_at = now()
  WHERE launch_id = p_launch_id
  RETURNING * INTO m;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_me_ok := p_magic_eden_status IN ('LISTED', 'CLAIMED', 'VERIFIED');
  v_te_ok := p_tensor_status IN ('LISTED', 'CLAIMED', 'VERIFIED');

  IF v_me_ok AND v_te_ok THEN
    UPDATE owl_center_launches
    SET marketplace_ready = true, updated_at = now()
    WHERE id = p_launch_id;
  END IF;

  IF m.trading_links_active OR (
    COALESCE(NULLIF(trim(m.magic_eden_url), ''), NULL) IS NOT NULL
    AND COALESCE(NULLIF(trim(m.tensor_url), ''), NULL) IS NOT NULL
  ) THEN
    UPDATE owl_center_launches
    SET
      magic_eden_url = NULLIF(trim(m.magic_eden_url), ''),
      tensor_url = NULLIF(trim(m.tensor_url), ''),
      updated_at = now()
    WHERE id = p_launch_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_marketplace_readiness(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_marketplace_readiness(uuid, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- RLS (service_role bypasses; no anon/authenticated policies)
-- ---------------------------------------------------------------------------
ALTER TABLE owl_center_asset_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE owl_center_marketplace_readiness ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Seed Gen2 asset package + marketplace row
-- ---------------------------------------------------------------------------
INSERT INTO owl_center_asset_packages (
  launch_id,
  logo_url,
  banner_url,
  collection_image_url,
  expected_supply,
  total_images,
  total_metadata,
  validation_status,
  metadata_upload_status,
  storage_provider,
  validation_checklist
)
SELECT
  l.id,
  l.image_url,
  NULL,
  l.image_url,
  2000,
  2000,
  2000,
  'PENDING',
  'NOT_UPLOADED',
  'pending',
  '{}'::jsonb
FROM owl_center_launches l
WHERE l.slug = 'gen2'
ON CONFLICT (launch_id) DO NOTHING;

INSERT INTO owl_center_marketplace_readiness (
  launch_id,
  metadata_status,
  verified_collection_status,
  magic_eden_status,
  tensor_status,
  trading_links_active,
  notes
)
SELECT
  l.id,
  'NOT_READY',
  'NOT_READY',
  'NOT_READY',
  'NOT_READY',
  false,
  'Gen2 — paste Magic Eden / Tensor URLs after indexing. Owl Center does not upload listings in V1.'
FROM owl_center_launches l
WHERE l.slug = 'gen2'
ON CONFLICT (launch_id) DO NOTHING;

COMMENT ON TABLE owl_center_asset_packages IS 'Collection images/metadata package tracking; V1 manual validation + paths.';
COMMENT ON TABLE owl_center_marketplace_readiness IS 'Manual marketplace indexing readiness; no ME/Tensor API integration in V1.';
