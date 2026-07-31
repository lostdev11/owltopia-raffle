-- Allow rev-share claim as a distinct platform-fee action (separate from OWL nest claim).
ALTER TABLE public.staking_platform_fee_payments
  DROP CONSTRAINT IF EXISTS staking_platform_fee_payments_action_check;

ALTER TABLE public.staking_platform_fee_payments
  ADD CONSTRAINT staking_platform_fee_payments_action_check
  CHECK (action IN ('stake', 'unstake', 'claim', 'rev_share_claim'));
