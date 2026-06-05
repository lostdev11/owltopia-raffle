-- Store generated hash list text on sell-out (for ME / Tensor creator submission).

ALTER TABLE public.owl_center_marketplace_readiness
  ADD COLUMN IF NOT EXISTS hash_list_text text,
  ADD COLUMN IF NOT EXISTS sellout_prepared_at timestamptz;

COMMENT ON COLUMN public.owl_center_marketplace_readiness.hash_list_text IS
  'Newline-delimited mint addresses generated when collection sells out.';
COMMENT ON COLUMN public.owl_center_marketplace_readiness.sellout_prepared_at IS
  'When sell-out marketplace prep (hash list + suggested URLs) last ran.';
