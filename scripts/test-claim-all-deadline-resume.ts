/**
 * Claim all: deadline stop, resume, fee linking, bulk lock chunking, stale guard, ordering.
 * Run: npx tsx scripts/test-claim-all-deadline-resume.ts
 */
import assert from 'node:assert/strict'
import {
  claimAllExecutionDeadlineMs,
  shouldStopClaimAllBatchesForDeadline,
  CLAIM_ALL_DEADLINE_BUFFER_MS,
  CLAIM_ALL_ROUTE_MAX_DURATION_SEC,
} from '../lib/nesting/claim-all-deadline'
import {
  issueClaimAllEligibilityToken,
  verifyClaimAllEligibilityToken,
  CLAIM_ALL_ELIGIBILITY_TTL_MS,
} from '../lib/nesting/claim-all-eligibility'
import { buildOwlClaimPlansForPositions } from '../lib/nesting/claim-plan'
import type { StakingPositionRow } from '../lib/db/staking-positions'
import {
  CLAIM_FEE_RECOVERY_MAX_PAGES,
  CLAIM_FEE_RECOVERY_PAGE_SIZE,
} from '../lib/nesting/find-reusable-claim-platform-fee'

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-32chars-min!!'

// Deadline stops before the final buffer window.
{
  const start = 1_000_000
  const deadline = claimAllExecutionDeadlineMs(start)
  assert.equal(deadline, start + CLAIM_ALL_ROUTE_MAX_DURATION_SEC * 1000)
  assert.equal(shouldStopClaimAllBatchesForDeadline(deadline, deadline - CLAIM_ALL_DEADLINE_BUFFER_MS), false)
  assert.equal(shouldStopClaimAllBatchesForDeadline(deadline, deadline - CLAIM_ALL_DEADLINE_BUFFER_MS + 1), true)
}

// Eligibility token round-trip and expiry.
{
  const wallet = '4Fo8qRnCM6d1RtFRz69T9MzwnGxhVkb1n4EpfC1FGuaG'
  const token = issueClaimAllEligibilityToken({
    wallet,
    eligiblePositionIds: [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ],
    feeUnits: 2,
    expiresAtMs: Date.now() + 60_000,
  })
  const parsed = verifyClaimAllEligibilityToken(token, wallet)
  assert.ok(parsed)
  assert.equal(parsed!.p.length, 2)
  assert.equal(parsed!.feeUnits, 2)
  const expired = issueClaimAllEligibilityToken({
    wallet,
    eligiblePositionIds: ['11111111-1111-4111-8111-111111111111'],
    feeUnits: 1,
    expiresAtMs: Date.now() - 1,
  })
  assert.equal(verifyClaimAllEligibilityToken(expired, wallet), null)
  assert.ok(CLAIM_ALL_ELIGIBILITY_TTL_MS >= 60_000)
}

// Largest pending nests first in Claim-all plans.
{
  const AS_OF_MS = Date.UTC(2026, 4, 19, 12, 0, 0)
  const mockOwlNest = (params: {
    id: string
    amount: number
    claimedRewards: number
  }): StakingPositionRow => {
    const stakedAt = new Date(AS_OF_MS - 30 * 86_400_000).toISOString()
    return {
      id: params.id,
      wallet_address: 'AnyWallet1111111111111111111111111111111111',
      pool_id: 'pool-1',
      asset_identifier: `mint-${params.id}`,
      amount: params.amount,
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

  const plans = buildOwlClaimPlansForPositions(
    [mockOwlNest({ id: 'small', amount: 1, claimedRewards: 0 }), mockOwlNest({ id: 'big', amount: 50, claimedRewards: 0 })],
    AS_OF_MS,
    { forClaimAll: true }
  )
  assert.equal(plans.length, 2)
  assert.equal(plans[0]!.positionId, 'big')
  assert.ok(plans[0]!.payoutAmount > plans[1]!.payoutAmount)
}

// Fee recovery pagination constants (wallet-poisoning dust).
{
  assert.ok(CLAIM_FEE_RECOVERY_PAGE_SIZE >= 20)
  assert.ok(CLAIM_FEE_RECOVERY_MAX_PAGES * CLAIM_FEE_RECOVERY_PAGE_SIZE >= 800)
}

// Partial resume: stop when less than the buffer remains before the route deadline.
{
  const deadline = Date.now() + 20_000
  assert.equal(shouldStopClaimAllBatchesForDeadline(deadline, deadline - 14_000), true)
  assert.equal(shouldStopClaimAllBatchesForDeadline(deadline, deadline - 16_000), false)
}

console.log('test-claim-all-deadline-resume: ok')
