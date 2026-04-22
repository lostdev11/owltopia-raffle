/**
 * Placeholder for future Solana program integration.
 * Pools with `adapter_mode === 'onchain_enabled'` route here until instructions + sync ship.
 * Transaction building lives under `lib/solana/nesting/*` (pdas, instructions, client) — not wired to this adapter yet.
 */

import type { StakingMutationAdapter } from '@/lib/nesting/adapters/types'
import { StakingUserError } from '@/lib/nesting/errors'

function notConfigured(): never {
  throw new StakingUserError(
    'On-chain staking is not configured for this pool yet. Use adapter_mode mock or solana_ready during rollout.',
    501
  )
}

export const solanaStakingAdapterStub: StakingMutationAdapter = {
  stakeIntoPool: notConfigured,
  unstakePosition: notConfigured,
  claimPositionRewards: notConfigured,
}
