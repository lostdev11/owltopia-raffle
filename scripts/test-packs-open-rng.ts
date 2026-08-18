/**
 * Unit-style checks for pack open RNG (no DB / chain).
 */
import assert from 'node:assert/strict'
import {
  generatePackOpenSeed,
  hashPackOpenCommit,
  pickCategory,
  pickTier,
  recomputeOpenFromSeed,
  verifyCommitHash,
} from '../lib/packs/rng'

const seed = generatePackOpenSeed()
const commit = hashPackOpenCommit(seed)
assert.equal(commit.length, 64)
assert.equal(verifyCommitHash(seed, commit), true)
assert.equal(verifyCommitHash(seed, '0'.repeat(64)), false)

const { category, pick } = recomputeOpenFromSeed(seed)
assert.equal(pickCategory(seed), category)
assert.deepEqual(pickTier(seed, category), pick)

// Determinism
for (let i = 0; i < 20; i++) {
  const s = generatePackOpenSeed()
  const a = recomputeOpenFromSeed(s)
  const b = recomputeOpenFromSeed(s)
  assert.deepEqual(a, b)
}

console.log('packs-open-rng: ok')
