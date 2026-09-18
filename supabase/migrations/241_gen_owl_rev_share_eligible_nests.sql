-- Freeze Gen Owl rev-share nest buckets at finalize so claim-time DAS/reclassify
-- cannot pay more 1/1 bonuses than the deposited pool was split for.

CREATE TABLE IF NOT EXISTS public.gen_owl_rev_share_eligible_nests (
  period_month TEXT NOT NULL REFERENCES public.gen_owl_rev_share_periods (period_month) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES public.staking_positions (id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  asset_identifier TEXT,
  group_key TEXT NOT NULL CHECK (group_key IN ('gen1-owl', 'gen2-owl')),
  bucket TEXT NOT NULL CHECK (bucket IN ('standard', 'one-of-one')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_month, position_id),
  CONSTRAINT gen_owl_rev_share_eligible_nests_period_month_format CHECK (period_month ~ '^\d{4}-\d{2}$')
);

COMMENT ON TABLE public.gen_owl_rev_share_eligible_nests IS
  'Finalize-time snapshot of eligible Gen Owl nests and 90/10 bucket. Claims must use this bucket, not live DAS reclassification.';

CREATE INDEX IF NOT EXISTS idx_gen_owl_rev_share_eligible_nests_wallet
  ON public.gen_owl_rev_share_eligible_nests (wallet_address, period_month DESC);

CREATE INDEX IF NOT EXISTS idx_gen_owl_rev_share_eligible_nests_group_bucket
  ON public.gen_owl_rev_share_eligible_nests (period_month, group_key, bucket);

ALTER TABLE public.gen_owl_rev_share_eligible_nests ENABLE ROW LEVEL SECURITY;

-- API + service role only (Next.js admin client).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gen_owl_rev_share_eligible_nests TO service_role;
