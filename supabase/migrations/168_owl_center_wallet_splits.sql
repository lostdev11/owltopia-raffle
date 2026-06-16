-- Creator-configurable royalty + mint fund wallet splits (percent shares must sum to 100).

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS royalty_splits jsonb,
  ADD COLUMN IF NOT EXISTS mint_fund_splits jsonb;

COMMENT ON COLUMN public.owl_center_launches.royalty_splits IS
  'Secondary sale royalty recipients: [{ "address": "<pubkey>", "share": 100 }, ...]. Baked into CM + NFT metadata at deploy.';

COMMENT ON COLUMN public.owl_center_launches.mint_fund_splits IS
  'Primary mint proceeds recipients: [{ "address": "<pubkey>", "share": 100 }, ...]. Used for treasury_wallet / solPayment guard setup.';

ALTER TABLE public.owl_center_submissions
  ADD COLUMN IF NOT EXISTS royalty_splits jsonb,
  ADD COLUMN IF NOT EXISTS mint_fund_splits jsonb;
