-- Allow soft (no-freeze) Partner Nesting applications: database_only lock standard.
-- Soft nests keep NFTs transferable; rewards require continued wallet ownership.

ALTER TABLE public.partner_nest_applications
  DROP CONSTRAINT IF EXISTS partner_nest_applications_nft_lock_standard_check;

ALTER TABLE public.partner_nest_applications
  ADD CONSTRAINT partner_nest_applications_nft_lock_standard_check
  CHECK (
    nft_lock_standard IN (
      'auto',
      'mpl_core_freeze_delegate',
      'spl_token_account_freeze',
      'database_only'
    )
  );

ALTER TABLE public.partner_nest_applications
  ALTER COLUMN locked SET DEFAULT FALSE;

ALTER TABLE public.partner_nest_applications
  ALTER COLUMN max_lock_days SET DEFAULT 0;

ALTER TABLE public.partner_nest_applications
  ALTER COLUMN min_lock_days SET DEFAULT 0;

ALTER TABLE public.partner_nest_applications
  ALTER COLUMN nft_lock_standard SET DEFAULT 'database_only';

COMMENT ON COLUMN public.partner_nest_applications.nft_lock_standard IS
  'auto / Core / SPL freeze = on-chain lock; database_only = soft nest (transferable, ownership-gated rewards).';
COMMENT ON COLUMN public.partner_nest_applications.locked IS
  'False = no lock period (typical soft nest). True = min/max lock days apply for freeze perches.';
