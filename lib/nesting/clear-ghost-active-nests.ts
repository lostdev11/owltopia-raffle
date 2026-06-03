import {
  listStakingPositionsByWallet,
  markPositionUnstaked,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import { sortStakingPositionsOldestFirst } from '@/lib/nesting/position-lifecycle'

export type ClearGhostActiveNestResult = {
  positionId: string
  cleared: boolean
  reason?: 'not_active' | 'has_mint'
}

export type ClearGhostActiveNestsForWalletResult = {
  wallet: string
  ghost_active_count: number
  cleared_count: number
  results: ClearGhostActiveNestResult[]
}

function isGhostActiveNest(position: StakingPositionRow): boolean {
  return position.status === 'active' && !position.asset_identifier?.trim()
}

/**
 * Closes active nest ledger rows that have no mint (failed open / partial DB write).
 * Does not touch real nests or on-chain state — safe when the holder still has claimable OWL.
 */
export async function clearGhostActiveNestsForWallet(
  wallet: string
): Promise<ClearGhostActiveNestsForWalletResult> {
  const holder = wallet.trim()
  const positions = sortStakingPositionsOldestFirst(await listStakingPositionsByWallet(holder))
  const results: ClearGhostActiveNestResult[] = []
  let ghostActiveCount = 0
  let clearedCount = 0

  for (const position of positions) {
    if (position.status !== 'active') {
      results.push({ positionId: position.id, cleared: false, reason: 'not_active' })
      continue
    }
    if (position.asset_identifier?.trim()) {
      results.push({ positionId: position.id, cleared: false, reason: 'has_mint' })
      continue
    }

    ghostActiveCount += 1
    await markPositionUnstaked(position.id, position.wallet_address, {
      sync_status: 'confirmed',
      last_synced_at: new Date().toISOString(),
      last_transaction_error: null,
      external_reference: 'ghost_active_cleared',
    })
    clearedCount += 1
    results.push({ positionId: position.id, cleared: true })
  }

  return {
    wallet: holder,
    ghost_active_count: ghostActiveCount,
    cleared_count: clearedCount,
    results,
  }
}

export function countGhostActiveNests(positions: StakingPositionRow[]): number {
  return positions.filter(isGhostActiveNest).length
}
