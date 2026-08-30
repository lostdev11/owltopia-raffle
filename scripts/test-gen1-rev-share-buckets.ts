/**
 * Gen 1 rev share: 90% across all nests + 10% 1/1 bonus.
 * Run: npx tsx scripts/test-gen1-rev-share-buckets.ts
 */
import assert from 'node:assert/strict'
import { computeGen1RevShareBucketAmounts } from '../lib/nesting/gen-owl-rev-share'

function almostEqual(actual: number | null, expected: number, label: string) {
  assert.ok(actual != null, `${label}: expected ${expected}, got null`)
  assert.ok(
    Math.abs(actual! - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`
  )
}

{
  // 200 standard + 10 1/1s, 100 SOL pool
  const buckets = computeGen1RevShareBucketAmounts({
    totalSol: 100,
    totalUsdc: null,
    standardCount: 200,
    oneOfOneCount: 10,
  })
  // 90 SOL ÷ 210 nests
  almostEqual(buckets.standard_per_nest_sol, 90 / 210, 'base share')
  // base + (10 SOL ÷ 10 1/1s)
  almostEqual(buckets.one_of_one_per_nest_sol, 90 / 210 + 1, '1/1 total share')
  assert.equal(buckets.standard_count, 200)
  assert.equal(buckets.one_of_one_count, 10)

  // Conservation: standard nests * base + 1/1s * total ≈ 100
  const paid =
    buckets.standard_count * (buckets.standard_per_nest_sol ?? 0) +
    buckets.one_of_one_count * (buckets.one_of_one_per_nest_sol ?? 0)
  almostEqual(paid, 100, 'pool conservation')
}

{
  // No 1/1s → full pool to all standard nests
  const buckets = computeGen1RevShareBucketAmounts({
    totalSol: 50,
    totalUsdc: 100,
    standardCount: 25,
    oneOfOneCount: 0,
  })
  almostEqual(buckets.standard_per_nest_sol, 2, 'std-only SOL')
  almostEqual(buckets.standard_per_nest_usdc, 4, 'std-only USDC')
  assert.equal(buckets.one_of_one_per_nest_sol, null)
  assert.equal(buckets.one_of_one_per_nest_usdc, null)
}

{
  // Only 1/1s → full pool to 1/1s
  const buckets = computeGen1RevShareBucketAmounts({
    totalSol: 30,
    totalUsdc: null,
    standardCount: 0,
    oneOfOneCount: 3,
  })
  assert.equal(buckets.standard_per_nest_sol, null)
  almostEqual(buckets.one_of_one_per_nest_sol, 10, 'ooo-only share')
}

{
  // Regression: exclusive-bucket math (old bug) would give 1/1 only 10/10 = 1 SOL
  // and standard 90/200 = 0.45 — 1/1 would miss the all-staked share.
  const buckets = computeGen1RevShareBucketAmounts({
    totalSol: 100,
    totalUsdc: null,
    standardCount: 200,
    oneOfOneCount: 10,
  })
  assert.ok(
    (buckets.one_of_one_per_nest_sol ?? 0) > 1,
    '1/1 must receive more than the 10% bonus alone'
  )
  assert.ok(
    (buckets.one_of_one_per_nest_sol ?? 0) > (buckets.standard_per_nest_sol ?? 0),
    '1/1 total must exceed the shared base amount'
  )
}

console.log('test-gen1-rev-share-buckets: ok')
