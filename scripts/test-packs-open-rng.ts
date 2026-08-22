/**
 * Unit-style checks for pack open RNG + per-NFT FP weighting (no DB / chain).
 */
import assert from 'node:assert/strict'
import {
  generatePackOpenSeed,
  hashPackOpenCommit,
  pickCategory,
  pickNftFromAvailableInventory,
  pickNftFromSnapshot,
  pickTier,
  recomputeOpenFromSeed,
  verifyCommitHash,
} from '../lib/packs/rng'
import { buildWeightedNftPool, nftFpWeight } from '../lib/packs/nft-weights'
import { computePackOddsPercentages } from '../lib/packs/odds'
import { PACK_OWL_TIERS } from '../lib/packs/config'

const seed = generatePackOpenSeed()
const commit = hashPackOpenCommit(seed)
assert.equal(commit.length, 64)
assert.equal(verifyCommitHash(seed, commit), true)
assert.equal(verifyCommitHash(seed, '0'.repeat(64)), false)

const { category, pick } = recomputeOpenFromSeed(seed)
assert.equal(pickCategory(seed), category)
if (category !== 'nft') {
  assert.deepEqual(pickTier(seed, category), pick)
}

// Determinism
for (let i = 0; i < 20; i++) {
  const s = generatePackOpenSeed()
  const a = recomputeOpenFromSeed(s)
  const b = recomputeOpenFromSeed(s)
  assert.deepEqual(a, b)
}

// OWL ladder capped at 50
assert.ok(PACK_OWL_TIERS.every((t) => t.amount <= 50))
assert.ok(!PACK_OWL_TIERS.some((t) => t.amount === 100))

// Higher FP → lower weight
assert.ok(nftFpWeight(0.05) > nftFpWeight(0.25))
assert.ok(nftFpWeight(0.25) > nftFpWeight(0.5))

const pool = buildWeightedNftPool([
  { id: 'a', mint_address: 'MintCheap1111111111111111111111111111111', fair_value_sol: 0.05 },
  { id: 'b', mint_address: 'MintMid222222222222222222222222222222222', fair_value_sol: 0.2 },
  { id: 'c', mint_address: 'MintHigh33333333333333333333333333333333', fair_value_sol: 0.5 },
])
assert.equal(pool.length, 3)
assert.ok(pool[0]!.weight > pool[2]!.weight)

// Per-NFT pick is deterministic + snapshot round-trip
const s2 = 'a'.repeat(64)
const { pick: nftPick, pool: weighted } = pickNftFromAvailableInventory(s2, [
  { id: 'a', mint_address: 'MintCheap1111111111111111111111111111111', fair_value_sol: 0.05 },
  { id: 'b', mint_address: 'MintMid222222222222222222222222222222222', fair_value_sol: 0.2 },
  { id: 'c', mint_address: 'MintHigh33333333333333333333333333333333', fair_value_sol: 0.5 },
])
const snap = weighted.map((p) => ({
  id: p.id,
  mint: p.mint_address,
  fair_value_sol: p.fair_value_sol,
  weight: p.weight,
}))
assert.equal(pickNftFromSnapshot(s2, snap).id, nftPick.id)

// Cheap NFT should win more often than expensive across many seeds
let cheap = 0
let expensive = 0
for (let i = 0; i < 500; i++) {
  const s = generatePackOpenSeed()
  const { pick: p } = pickNftFromAvailableInventory(s, [
    { id: 'cheap', mint_address: 'Cheap11111111111111111111111111111111111', fair_value_sol: 0.05 },
    { id: 'exp', mint_address: 'Expensive2222222222222222222222222222222', fair_value_sol: 0.5 },
  ])
  if (p.id === 'cheap') cheap++
  else expensive++
}
assert.ok(cheap > expensive, `expected cheap wins > expensive (${cheap} vs ${expensive})`)

const odds = computePackOddsPercentages({
  nftInventory: [
    { id: 'a', mint_address: 'MintA', fair_value_sol: 0.05, name: 'A' },
    { id: 'b', mint_address: 'MintB', fair_value_sol: 0.5, name: 'B' },
  ],
})
assert.equal(odds.categories.reduce((s, c) => s + c.percent, 0), 100)
assert.ok(odds.nftInventory[0]!.percentOfCategory > odds.nftInventory[1]!.percentOfCategory)

console.log('packs-open-rng: ok')
