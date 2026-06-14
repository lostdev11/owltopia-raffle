-- Platform fee payments for nest stake / unstake / claim (0.001 SOL per nest per action by default).
-- One on-chain tx can cover multiple nests (units = lamports / unit fee).

CREATE TABLE IF NOT EXISTS public.staking_platform_fee_payments (
  tx_signature TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('stake', 'unstake', 'claim')),
  units INTEGER NOT NULL CHECK (units > 0),
  lamports BIGINT NOT NULL CHECK (lamports > 0),
  position_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staking_platform_fee_wallet
  ON public.staking_platform_fee_payments (wallet_address, created_at DESC);

COMMENT ON TABLE public.staking_platform_fee_payments IS
  'On-chain SOL platform fees for nesting stake/unstake/claim; API + service role only.';

ALTER TABLE public.staking_platform_fee_payments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staking_platform_fee_payments TO service_role;
