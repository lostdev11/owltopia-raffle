/**
 * Rev-share claim fee is fixed 0.0001 SOL/nest; OWL claim stays 0.001.
 * Run: npx tsx scripts/test-rev-share-claim-platform-fee.ts
 */
import assert from 'node:assert/strict'
import {
  formatStakingPlatformFeeTotalLabel,
  getRevShareClaimPlatformFeeLamports,
  getRevShareClaimPlatformFeeSol,
  getStakingPlatformFeeLamports,
  getStakingPlatformFeeSol,
  getStakingPlatformFeeSolForAction,
  getStakingPlatformFeeUnitLamportsForAction,
} from '../lib/nesting/staking-platform-fee'

assert.equal(getStakingPlatformFeeSol(), 0.001)
assert.equal(getRevShareClaimPlatformFeeSol(), 0.0001)
assert.equal(getStakingPlatformFeeSolForAction('claim'), 0.001)
assert.equal(getStakingPlatformFeeSolForAction('rev_share_claim'), 0.0001)
assert.equal(getStakingPlatformFeeSolForAction('stake'), 0.001)

assert.equal(getStakingPlatformFeeLamports(), 1_000_000)
assert.equal(getRevShareClaimPlatformFeeLamports(), 100_000)
assert.equal(getStakingPlatformFeeUnitLamportsForAction('claim'), 1_000_000)
assert.equal(getStakingPlatformFeeUnitLamportsForAction('rev_share_claim'), 100_000)

// 2343 nests × 0.0001 = 0.2343 SOL (Gembird's example)
const nests = 2343
const total = getRevShareClaimPlatformFeeSol() * nests
assert.ok(Math.abs(total - 0.2343) < 1e-9)
assert.ok(Math.abs(getStakingPlatformFeeSol() * nests - 2.343) < 1e-9)

const label = formatStakingPlatformFeeTotalLabel(nests, 'rev_share_claim')
// total ≥ 0.01 uses 3 dp (matches Gembird: 2343 × 0.0001 → "0.234 fees")
assert.match(label, /0\.234 SOL/)
assert.match(label, /2343 NFTs/)
assert.match(label, /0\.0001 SOL/)

const owlLabel = formatStakingPlatformFeeTotalLabel(nests, 'claim')
assert.match(owlLabel, /2\.343 SOL/)
assert.match(owlLabel, /0\.0010 SOL/)

console.log('test-rev-share-claim-platform-fee: ok')
