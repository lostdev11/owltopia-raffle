/**
 * Claim all: combined ≥1 OWL across nests (per-nest may be below 1 OWL). Wallet-agnostic plan builder.
 * Run: npx tsx scripts/test-claim-all-combined-threshold.ts
 */
import assert from 'node:assert/strict'
import type { StakingPositionRow } from '../lib/db/staking-positions'
import {
  buildFullPositionClaimPlan,
  buildOwlClaimAllPreview,
  buildOwlClaimPlansForPositions,
} from '../lib/nesting/claim-plan'

const AS_OF_MS = Date.UTC(2026, 4, 19, 12, 0, 0)

function mockOwlNest(params: {
  id: string
  claimedRewards: number
  stakedDaysAgo: number
}): StakingPositionRow {
  const stakedAt = new Date(AS_OF_MS - params.stakedDaysAgo * 86_400_000).toISOString()
  return {
    id: params.id,
    wallet_address: 'AnyWallet1111111111111111111111111111111111',
    pool_id: 'pool-1',
    asset_identifier: `mint-${params.id}`,
    amount: 1,
    reward_rate_snapshot: 1,
    reward_rate_unit_snapshot: 'daily',
    reward_token_snapshot: 'OWL',
    staked_at: stakedAt,
    unlock_at: null,
    unstaked_at: null,
    claimed_rewards: params.claimedRewards,
    status: 'active',
    created_at: stakedAt,
    updated_at: stakedAt,
  }
}

/** ~0.77 OWL pending per nest after heavy prior claims (matches multi-nest wallets). */
const subMinNest = mockOwlNest({ id: 'a', claimedRewards: 3.23, stakedDaysAgo: 4 })

// Three sub-1 nests → Claim all ready (~2.31 combined); per-nest plans empty.
{
  const rows = [
    subMinNest,
    mockOwlNest({ id: 'b', claimedRewards: 3.23, stakedDaysAgo: 4 }),
    mockOwlNest({ id: 'c', claimedRewards: 3.23, stakedDaysAgo: 4 }),
  ]
  const perNest = buildOwlClaimPlansForPositions(rows, AS_OF_MS)
  const claimAll = buildOwlClaimAllPreview(rows, AS_OF_MS)
  assert.equal(perNest.length, 0)
  assert.equal(claimAll.count, 3)
  assert.ok(claimAll.totalOwl >= 2.3 && claimAll.totalOwl <= 2.35)
  assert.equal(claimAll.ready, true)
}

// Single nest ≥1 OWL → both per-nest and Claim all ready.
{
  const row = mockOwlNest({ id: 'solo', claimedRewards: 0, stakedDaysAgo: 2 })
  const perNest = buildOwlClaimPlansForPositions([row], AS_OF_MS)
  const claimAll = buildOwlClaimAllPreview([row], AS_OF_MS)
  assert.equal(perNest.length, 1)
  assert.equal(claimAll.count, 1)
  assert.ok(claimAll.totalOwl >= 2)
  assert.equal(claimAll.ready, true)
}

// Combined <1 OWL → Claim all not ready.
{
  const rows = [
    mockOwlNest({ id: 'x', claimedRewards: 3.7, stakedDaysAgo: 4 }),
    mockOwlNest({ id: 'y', claimedRewards: 3.7, stakedDaysAgo: 4 }),
  ]
  const claimAll = buildOwlClaimAllPreview(rows, AS_OF_MS)
  assert.equal(claimAll.count, 2)
  assert.ok(claimAll.totalOwl > 0 && claimAll.totalOwl < 1)
  assert.equal(claimAll.ready, false)
}

// Mixed: one nest ≥1 OWL + sub-min nests → Claim all includes all pending nests.
{
  const rows = [
    mockOwlNest({ id: 'big', claimedRewards: 0, stakedDaysAgo: 3 }),
    subMinNest,
  ]
  const claimAll = buildOwlClaimAllPreview(rows, AS_OF_MS)
  assert.equal(claimAll.count, 2)
  assert.equal(claimAll.ready, true)
  assert.ok(
    buildFullPositionClaimPlan(rows[0]!, AS_OF_MS),
    'per-nest claim on large nest'
  )
  assert.equal(buildFullPositionClaimPlan(subMinNest, AS_OF_MS), null, 'per-nest blocked under 1 OWL')
}

console.log('claim-all-combined-threshold: ok')
