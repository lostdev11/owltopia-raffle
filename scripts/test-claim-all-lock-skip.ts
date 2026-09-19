/**
 * Claim all: unlocked nests are skipped; transient lock-read failures must abort (no silent underpay).
 * Run: npx tsx scripts/test-claim-all-lock-skip.ts
 */
import assert from 'node:assert/strict'
import { meetsMinOwlClaimThreshold, MIN_OWL_CLAIMABLE_TO_CLAIM } from '../lib/staking/rewards'

type Plan = { positionId: string; payoutAmount: number }

function filterPlansAfterLockSkip(
  plans: Plan[],
  eligibleIds: Set<string>
): { claimPlans: Plan[]; skippedCount: number; skippedOwl: number; total: number } {
  const claimPlans = plans.filter((p) => eligibleIds.has(p.positionId))
  const skipped = plans.filter((p) => !eligibleIds.has(p.positionId))
  const skippedCount = skipped.length
  const skippedOwl = skipped.reduce((s, p) => s + p.payoutAmount, 0)
  const total = claimPlans.reduce((s, p) => s + p.payoutAmount, 0)
  return { claimPlans, skippedCount, skippedOwl, total }
}

function shouldAbortClaimAllForTransientLocks(params: {
  transientCount: number
  trueSkipCount: number
}): 'abort' | 'pay_eligible' {
  // Transient RPC failures must abort before any OWL transfer (fee reusable).
  if (params.transientCount > 0) return 'abort'
  return 'pay_eligible'
}

const plans: Plan[] = [
  { positionId: 'a', payoutAmount: 10 },
  { positionId: 'b', payoutAmount: 5 },
  { positionId: 'bad', payoutAmount: 2 },
]

// Skip one unlocked nest — remaining still claimable.
{
  const { claimPlans, skippedCount, skippedOwl, total } = filterPlansAfterLockSkip(
    plans,
    new Set(['a', 'b'])
  )
  assert.equal(skippedCount, 1)
  assert.equal(skippedOwl, 2)
  assert.equal(claimPlans.length, 2)
  assert.equal(total, 15)
  assert.equal(meetsMinOwlClaimThreshold(total), true)
  assert.equal(
    shouldAbortClaimAllForTransientLocks({ transientCount: 0, trueSkipCount: 1 }),
    'pay_eligible'
  )
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

// Stampede-style underpay: RPC flakes must NOT be treated as unlocked skips.
{
  const large: Plan[] = [
    { positionId: 'ok1', payoutAmount: 1900 },
    { positionId: 'flake', payoutAmount: 649 },
  ]
  assert.equal(
    shouldAbortClaimAllForTransientLocks({ transientCount: 1, trueSkipCount: 0 }),
    'abort'
  )
  // If we wrongly skipped the flake nest, UI would still show ~649 claimable after "success".
  const wrong = filterPlansAfterLockSkip(large, new Set(['ok1']))
  assert.equal(wrong.total, 1900)
  assert.equal(wrong.skippedOwl, 649)
}

console.log('claim-all-lock-skip: ok')
