-- Admin-controlled pause for stake / claim / unstake (UI + server), separate from public landing visibility.
-- Combined with NESTING_DISABLED env on the server (env still wins for hard incident kill).

ALTER TABLE public.nesting_public_settings
  ADD COLUMN IF NOT EXISTS nesting_operations_paused BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.nesting_public_settings.nesting_operations_paused IS
  'When true, new nests, claims, and voluntary leave-nest are blocked (same UX as NESTING_DISABLED env).';
