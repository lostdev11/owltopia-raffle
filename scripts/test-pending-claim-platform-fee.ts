/**
 * Unit tests for pending claim platform-fee reuse helpers.
 * Run: npx tsx scripts/test-pending-claim-platform-fee.ts
 */
import assert from 'node:assert/strict'
import {
  claimRetryWithoutRepayMessage,
  isPendingClaimPlatformFeeFresh,
  parsePendingClaimPlatformFee,
  pendingClaimPlatformFeeCovers,
  PENDING_CLAIM_FEE_TTL_MS,
} from '../lib/nesting/pending-claim-platform-fee'

const now = 1_700_000_000_000

assert.equal(parsePendingClaimPlatformFee(null), null)
assert.equal(parsePendingClaimPlatformFee({ wallet: 'w', signature: '', units: 1 }), null)

const parsed = parsePendingClaimPlatformFee({
  wallet: ' Wallet1 ',
  signature: ' Sig1 ',
  units: 3.9,
  savedAtMs: now,
})
assert.ok(parsed)
assert.equal(parsed!.wallet, 'Wallet1')
assert.equal(parsed!.signature, 'Sig1')
assert.equal(parsed!.units, 3)
assert.equal(parsed!.savedAtMs, now)

assert.equal(isPendingClaimPlatformFeeFresh(parsed!, now + PENDING_CLAIM_FEE_TTL_MS - 1), true)
assert.equal(isPendingClaimPlatformFeeFresh(parsed!, now + PENDING_CLAIM_FEE_TTL_MS + 1), false)

assert.equal(pendingClaimPlatformFeeCovers(parsed!, 'Wallet1', 3, now), true)
assert.equal(pendingClaimPlatformFeeCovers(parsed!, 'Wallet1', 2, now), true)
assert.equal(pendingClaimPlatformFeeCovers(parsed!, 'Wallet1', 4, now), false)
assert.equal(pendingClaimPlatformFeeCovers(parsed!, 'Other', 1, now), false)

assert.match(claimRetryWithoutRepayMessage(1), /platform fee was paid/i)
assert.match(claimRetryWithoutRepayMessage(5), /5 nest platform fees were paid/i)

console.log('pending-claim-platform-fee: ok')
