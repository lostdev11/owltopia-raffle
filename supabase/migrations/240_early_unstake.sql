-- Early unstake: 0.2 SOL fee action + flag so early-left nests forfeit Gen Owl rev share.

ALTER TABLE public.staking_platform_fee_payments
  DROP CONSTRAINT IF EXISTS staking_platform_fee_payments_action_check;

ALTER TABLE public.staking_platform_fee_payments
  ADD CONSTRAINT staking_platform_fee_payments_action_check
  CHECK (action IN ('stake', 'unstake', 'claim', 'rev_share_claim', 'early_unstake'));

ALTER TABLE public.staking_positions
  ADD COLUMN IF NOT EXISTS early_unstake BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.staking_positions.early_unstake IS
  'True when the nest was closed before unlock_at via Early Unstake. These nests do not count toward Gen Owl rev share.';

CREATE INDEX IF NOT EXISTS idx_staking_positions_early_unstake
  ON public.staking_positions (early_unstake)
  WHERE early_unstake = TRUE;
