/**
 * Gen owl rev share: 90% across all nests + 10% 1/1 bonus (Gen 1 and Gen 2).
 * Run: npx tsx scripts/test-gen1-rev-share-buckets.ts
 */
import assert from 'node:assert/strict'
import { computeGenOwlRevShareBucketAmounts } from '../lib/nesting/gen-owl-rev-share'
import { isGen2OneOfOneFromDasAsset } from '../lib/nesting/gen2-one-of-one'

function almostEqual(actual: number | null, expected: number, label: string) {
  assert.ok(actual != null, `${label}: expected ${expected}, got null`)
  assert.ok(
    Math.abs(actual! - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`
  )
}

{
  const buckets = computeGenOwlRevShareBucketAmounts({
    totalSol: 100,
    totalUsdc: null,
    standardCount: 200,
    oneOfOneCount: 10,
  })
  almostEqual(buckets.standard_per_nest_sol, 90 / 210, 'base share')
  almostEqual(buckets.one_of_one_per_nest_sol, 90 / 210 + 1, '1/1 total share')
  assert.equal(buckets.standard_count, 200)
  assert.equal(buckets.one_of_one_count, 10)

  const paid =
    buckets.standard_count * (buckets.standard_per_nest_sol ?? 0) +
    buckets.one_of_one_count * (buckets.one_of_one_per_nest_sol ?? 0)
  almostEqual(paid, 100, 'pool conservation')
}

{
  const buckets = computeGenOwlRevShareBucketAmounts({
    totalSol: 50,
    totalUsdc: 100,
    standardCount: 25,
    oneOfOneCount: 0,
  })
  almostEqual(buckets.standard_per_nest_sol, 2, 'std-only SOL')
  almostEqual(buckets.standard_per_nest_usdc, 4, 'std-only USDC')
  assert.equal(buckets.one_of_one_per_nest_sol, null)
}

{
  const buckets = computeGenOwlRevShareBucketAmounts({
    totalSol: 30,
    totalUsdc: null,
    standardCount: 0,
    oneOfOneCount: 3,
  })
  assert.equal(buckets.standard_per_nest_sol, null)
  almostEqual(buckets.one_of_one_per_nest_sol, 10, 'ooo-only share')
}

{
  // Gen 2-shaped pool: 7 SOL across 1397 nests with a few 1/1s
  const buckets = computeGenOwlRevShareBucketAmounts({
    totalSol: 7,
    totalUsdc: null,
    standardCount: 1390,
    oneOfOneCount: 7,
  })
  almostEqual(buckets.standard_per_nest_sol, (7 * 0.9) / 1397, 'gen2 base')
  almostEqual(
    buckets.one_of_one_per_nest_sol,
    (7 * 0.9) / 1397 + (7 * 0.1) / 7,
    'gen2 1/1 total'
  )
}

{
  const das = {
    content: {
      metadata: {
        attributes: [{ trait_type: '1/1', value: 'Water King' }],
      },
    },
  }
  assert.equal(isGen2OneOfOneFromDasAsset('Mint111', das), true)
  assert.equal(
    isGen2OneOfOneFromDasAsset('Mint222', {
      content: { metadata: { attributes: [{ trait_type: 'Special', value: 'Nope' }] } },
    }),
    false
  )
}

console.log('test-gen1-rev-share-buckets: ok')
