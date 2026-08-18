-- Orbis as a first-class marketplace track (alongside Magic Eden + Tensor).

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS orbis_url text;

COMMENT ON COLUMN public.owl_center_launches.orbis_url IS
  'Public Orbis collection URL after listing (e.g. https://www.orbisonsol.io/marketplace/{pathname}).';

COMMENT ON COLUMN public.owl_center_launches.marketplace_ready IS
  'Secondary marketplaces verified (Orbis and/or Magic Eden + Tensor; manual tracking).';

ALTER TABLE public.owl_center_marketplace_readiness
  ADD COLUMN IF NOT EXISTS orbis_url text,
  ADD COLUMN IF NOT EXISTS orbis_status text NOT NULL DEFAULT 'NOT_READY';

COMMENT ON COLUMN public.owl_center_marketplace_readiness.orbis_url IS
  'Live Orbis marketplace collection URL after the creator lists the collection.';
COMMENT ON COLUMN public.owl_center_marketplace_readiness.orbis_status IS
  'Orbis listing track status (same enum as magic_eden_status / tensor_status).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'owl_center_marketplace_orbis_check'
  ) THEN
    ALTER TABLE public.owl_center_marketplace_readiness
      ADD CONSTRAINT owl_center_marketplace_orbis_check CHECK (
        orbis_status IN (
          'NOT_READY',
          'READY_FOR_INDEXING',
          'INDEXING',
          'LISTED',
          'CLAIMED',
          'VERIFIED',
          'NEEDS_MANUAL_REVIEW'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_owl_center_marketplace_orbis
  ON public.owl_center_marketplace_readiness (orbis_status);
