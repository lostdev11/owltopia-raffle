-- Metaplex Core "Freeze Collection" — founder-controlled, non-transferable until thaw.
-- Core (FreezeDelegate plugin) has no 30-day cap, unlike the legacy candy guard.
-- API + service_role only — no anon/authenticated Data API access (table is API-only).

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS freeze_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unfreeze_date timestamptz,
  ADD COLUMN IF NOT EXISTS freeze_status text NOT NULL DEFAULT 'disabled'
    CHECK (freeze_status IN ('disabled', 'pending', 'frozen', 'thawing', 'thawed', 'failed')),
  ADD COLUMN IF NOT EXISTS freeze_authority text,
  ADD COLUMN IF NOT EXISTS freeze_thawed_at timestamptz,
  ADD COLUMN IF NOT EXISTS freeze_progress jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.owl_center_launches.mint_standard IS
  'token_metadata = legacy NFT (Candy Machine v3); core = Metaplex Core (FreezeDelegate-capable, lower fees).';
COMMENT ON COLUMN public.owl_center_launches.freeze_enabled IS
  'When true (Core only), minted assets are frozen (non-transferable) until the creator thaws.';
COMMENT ON COLUMN public.owl_center_launches.unfreeze_date IS
  'Optional date after which assets become eligible to be unfrozen (also unfreezeable on sellout).';
COMMENT ON COLUMN public.owl_center_launches.freeze_status IS
  'disabled = no freeze; pending = configured pre-deploy; frozen = active; thawing/thawed = unfreeze flow.';
COMMENT ON COLUMN public.owl_center_launches.freeze_authority IS
  'Delegate pubkey that holds the FreezeDelegate authority for this collection.';

ALTER TABLE public.owl_center_submissions
  ADD COLUMN IF NOT EXISTS mint_standard text NOT NULL DEFAULT 'token_metadata',
  ADD COLUMN IF NOT EXISTS freeze_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unfreeze_date timestamptz;

COMMENT ON COLUMN public.owl_center_submissions.mint_standard IS
  'Requested mint standard: token_metadata (legacy) or core (Metaplex Core).';
