/**
 * Claim all: unlocked nests are skipped so one bad perch does not block payout.
 * Run: npx tsx scripts/test-claim-all-lock-skip.ts
 */
import assert from 'node:assert/strict'
import { meetsMinOwlClaimThreshold, MIN_OWL_CLAIMABLE_TO_CLAIM } from '../lib/staking/rewards'

type Plan = { positionId: string; payoutAmount: number }

function filterPlansAfterLockSkip(
  plans: Plan[],
  eligibleIds: Set<string>
): { claimPlans: Plan[]; skippedCount: number; total: number } {
  const claimPlans = plans.filter((p) => eligibleIds.has(p.positionId))
  const skippedCount = plans.length - claimPlans.length
  const total = claimPlans.reduce((s, p) => s + p.payoutAmount, 0)
  return { claimPlans, skippedCount, total }
}

const plans: Plan[] = [
  { positionId: 'a', payoutAmount: 10 },
  { positionId: 'b', payoutAmount: 5 },
  { positionId: 'bad', payoutAmount: 2 },
]

// Skip one unlocked nest — remaining still claimable.
{
  const { claimPlans, skippedCount, total } = filterPlansAfterLockSkip(
    plans,
    new Set(['a', 'b'])
  )
  assert.equal(skippedCount, 1)
  assert.equal(claimPlans.length, 2)
  assert.equal(total, 15)
  assert.equal(meetsMinOwlClaimThreshold(total), true)
}

// All unlocked — nothing to pay.
{
  const { claimPlans, skippedCount, total } = filterPlansAfterLockSkip(plans, new Set())
  assert.equal(skippedCount, 3)
  assert.equal(claimPlans.length, 0)
  assert.equal(total, 0)
  assert.equal(meetsMinOwlClaimThreshold(total), false)
}

// Skip leaves sub-minimum OWL.
{
  const tiny: Plan[] = [
    { positionId: 'ok', payoutAmount: 0.4 },
    { positionId: 'bad', payoutAmount: 5 },
  ]
  const { total, skippedCount } = filterPlansAfterLockSkip(tiny, new Set(['ok']))
  assert.equal(skippedCount, 1)
  assert.equal(meetsMinOwlClaimThreshold(total), false)
  assert.ok(total < MIN_OWL_CLAIMABLE_TO_CLAIM)
}

console.log('claim-all-lock-skip: ok')
