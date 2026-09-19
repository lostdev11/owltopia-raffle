/**
 * Rev share claim bucket budget + pool conservation.
 * Run: npx tsx scripts/test-gen-owl-rev-share-claim-bucket.ts
 */
import assert from 'node:assert/strict'
import {
  applyOneOfOneBudgetCap,
  claimAmountLooksLikeOneOfOne,
} from '../lib/nesting/gen-owl-rev-share-claim-bucket'
import { computeGenOwlRevShareBucketAmounts } from '../lib/nesting/gen-owl-rev-share'

{
  assert.equal(
    applyOneOfOneBudgetCap({ desired: 'standard', budgetedOneOfOneCount: 3, paidOneOfOneCount: 0 }),
    'standard'
  )
  assert.equal(
    applyOneOfOneBudgetCap({ desired: 'one-of-one', budgetedOneOfOneCount: 3, paidOneOfOneCount: 2 }),
    'one-of-one'
  )
  assert.equal(
    applyOneOfOneBudgetCap({ desired: 'one-of-one', budgetedOneOfOneCount: 3, paidOneOfOneCount: 3 }),
    'standard'
  )
  assert.equal(
    applyOneOfOneBudgetCap({ desired: 'one-of-one', budgetedOneOfOneCount: 0, paidOneOfOneCount: 0 }),
    'standard'
  )
}

{
  // Stampede/OwLilly-style overpay: finalize budgeted 3 ones, 8 already paid as 1/1.
  assert.equal(
    applyOneOfOneBudgetCap({ desired: 'one-of-one', budgetedOneOfOneCount: 3, paidOneOfOneCount: 8 }),
    'standard'
  )
}

{
  const buckets = computeGenOwlRevShareBucketAmounts({
    totalSol: 8.6,
    totalUsdc: null,
    standardCount: 1670,
    oneOfOneCount: 4,
  })
  const std = buckets.standard_per_nest_sol ?? 0
  const ooo = buckets.one_of_one_per_nest_sol ?? 0
  assert.ok(ooo > std)

  assert.equal(
    claimAmountLooksLikeOneOfOne({
      amountSol: ooo,
      amountUsdc: 0,
      standardSol: std,
      standardUsdc: 0,
      oneOfOneSol: ooo,
      oneOfOneUsdc: 0,
    }),
    true
  )
  assert.equal(
    claimAmountLooksLikeOneOfOne({
      amountSol: std,
      amountUsdc: 0,
      standardSol: std,
      standardUsdc: 0,
      oneOfOneSol: ooo,
      oneOfOneUsdc: 0,
    }),
    false
  )

  // Conserved if we only pay budgeted ones + the rest at standard.
  const paid =
    buckets.standard_count * std + buckets.one_of_one_count * ooo
  assert.ok(Math.abs(paid - 8.6) < 1e-9, `pool conservation got ${paid}`)

  // Uncapped extras at 1/1 rate would overshoot (the bug we are fixing).
  const overpay = buckets.standard_count * std + 16 * ooo
  assert.ok(overpay > 8.6 + 0.5, `expected material overpay, got ${overpay}`)
}

console.log('gen-owl-rev-share-claim-bucket: ok')
