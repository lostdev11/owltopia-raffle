import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingMutationAdapter } from '@/lib/nesting/adapters/types'
import { mockStakingAdapter } from '@/lib/nesting/adapters/mock'
import { solanaStakingAdapterStub } from '@/lib/nesting/adapters/solana'

/**
 * Chooses execution path per pool. `mock` and `solana_ready` keep the DB-backed mock path so
 * production behavior stays stable until real transactions are wired. `onchain_enabled` uses
 * the Solana stub (explicit error until the program client exists).
 */
export function resolveMutationAdapter(pool: StakingPoolRow): StakingMutationAdapter {
  const mode = pool.adapter_mode ?? 'mock'
  if (mode === 'onchain_enabled') {
    return solanaStakingAdapterStub
  }
  return mockStakingAdapter
}
