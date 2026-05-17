-- Owl Nesting: on-chain token custody hardening.
-- Prevent the same wallet-signed transaction from activating multiple staking rows.

CREATE UNIQUE INDEX IF NOT EXISTS staking_positions_stake_signature_unique
  ON public.staking_positions (stake_signature)
  WHERE stake_signature IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staking_positions_unstake_signature_unique
  ON public.staking_positions (unstake_signature)
  WHERE unstake_signature IS NOT NULL;

COMMENT ON INDEX public.staking_positions_stake_signature_unique IS
  'Each on-chain stake transfer signature may activate at most one staking position.';

COMMENT ON INDEX public.staking_positions_unstake_signature_unique IS
  'Each on-chain unstake transfer signature may close at most one staking position.';
