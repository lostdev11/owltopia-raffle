/**
 * Unit-style checks for pack open RNG + per-NFT FP weighting + 1% odds tier (no DB / chain).
 */
import assert from 'node:assert/strict'
import {
  generatePackOpenSeed,
  hashPackOpenCommit,
  pickCategory,
  pickJackpotWin,
  pickNftFromAvailableInventory,
  pickNftFromSnapshot,
  pickPremiumNftRoll,
  pickTier,
  recomputeOpenFromSeed,
  verifyCommitHash,
} from '../lib/packs/rng'
import {
  buildWeightedNftPool,
  nftFpWeight,
  resolveNftPoolMaxFairSol,
  splitNftPoolByOddsTier,
} from '../lib/packs/nft-weights'
import { computePackOddsPercentages } from '../lib/packs/odds'
import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_OWL_TIERS,
  PACK_PREMIUM_NFT_OVERALL_BPS,
  PACK_SOL_TIERS,
} from '../lib/packs/config'

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

for (let i = 0; i < 20; i++) {
  const s = generatePackOpenSeed()
  assert.deepEqual(recomputeOpenFromSeed(s), recomputeOpenFromSeed(s))
}

assert.equal(PACK_CATEGORY_WEIGHTS_BPS.owl, 3000)
assert.equal(PACK_CATEGORY_WEIGHTS_BPS.sol, 3000)
assert.equal(PACK_CATEGORY_WEIGHTS_BPS.nft, 4000)

assert.ok(PACK_OWL_TIERS.every((t) => t.amount >= 10 && t.amount <= 50))
assert.ok(PACK_OWL_TIERS.some((t) => t.amount === 10))
assert.ok(PACK_OWL_TIERS.some((t) => t.amount === 50))

const solAmounts = PACK_SOL_TIERS.map((t) => t.amountSol)
assert.ok(solAmounts.includes(0.05))
assert.ok(solAmounts.includes(0.1))
assert.ok(solAmounts.includes(0.2))
assert.ok(solAmounts.includes(0.5))
assert.equal(
  PACK_SOL_TIERS.reduce((s, t) => s + t.weight, 0),
  100
)

assert.ok(nftFpWeight(0.05) > nftFpWeight(0.25))
assert.ok(nftFpWeight(0.25) > nftFpWeight(0.5))

const premiumMax = resolveNftPoolMaxFairSol([0.05, 0.5, 2])
assert.equal(premiumMax, 2)
assert.ok(nftFpWeight(0.5, { maxFp: 2 }) > nftFpWeight(2, { maxFp: 2 }))

const pool = buildWeightedNftPool([
  { id: 'a', mint_address: 'MintCheap1111111111111111111111111111111', fair_value_sol: 0.05 },
  { id: 'b', mint_address: 'MintMid222222222222222222222222222222222', fair_value_sol: 0.2 },
  { id: 'c', mint_address: 'MintHigh33333333333333333333333333333333', fair_value_sol: 0.5 },
])
assert.equal(pool.length, 3)
assert.ok(pool[0]!.weight > pool[2]!.weight)

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
  odds_tier: p.odds_tier,
}))
assert.equal(pickNftFromSnapshot(s2, snap).id, nftPick.id)

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

const inventory = [
  {
    id: 'fill',
    mint_address: 'Fill111111111111111111111111111111111111',
    fair_value_sol: 0.08,
    odds_tier: 'standard' as const,
  },
  {
    id: 'chase',
    mint_address: 'Chase22222222222222222222222222222222222',
    fair_value_sol: 0.5,
    odds_tier: 'premium_1pct' as const,
  },
]
const split = splitNftPoolByOddsTier(inventory)
assert.equal(split.premium.length, 1)
assert.equal(split.standard.length, 1)

let premiumHits = 0
const trials = 20_000
for (let i = 0; i < trials; i++) {
  const s = generatePackOpenSeed()
  if (!pickPremiumNftRoll(s)) continue
  const { pick: p, usedPremiumPool } = pickNftFromAvailableInventory(s, inventory)
  if (usedPremiumPool && p.id === 'chase') premiumHits++
}
const rate = premiumHits / trials
assert.ok(
  rate > 0.015 && rate < 0.04,
  `premium NFT pick rate within NFT path should be ~2.5% (got ${(rate * 100).toFixed(2)}%)`
)
assert.equal(PACK_PREMIUM_NFT_OVERALL_BPS, 100)

assert.equal(pickJackpotWin('a'.repeat(64), 0), false)
assert.equal(pickJackpotWin('b'.repeat(64), 10_000), true)

const odds = computePackOddsPercentages({
  nftInventory: [
    { id: 'a', mint_address: 'MintA', fair_value_sol: 0.05, name: 'A', odds_tier: 'standard' },
    { id: 'b', mint_address: 'MintB', fair_value_sol: 0.5, name: 'B', odds_tier: 'premium_1pct' },
  ],
})
assert.equal(
  odds.categories.reduce((s, c) => s + c.percent, 0),
  100
)
assert.equal(odds.categories.find((c) => c.category === 'owl')?.percent, 30)
assert.equal(odds.categories.find((c) => c.category === 'sol')?.percent, 30)
assert.equal(odds.categories.find((c) => c.category === 'nft')?.percent, 40)
assert.equal(odds.premiumNft.overallBps, 100)
assert.equal(odds.premiumNft.items.length, 1)
assert.equal(odds.premiumNft.items[0]!.mint, 'MintB')

console.log('packs-open-rng: ok')
