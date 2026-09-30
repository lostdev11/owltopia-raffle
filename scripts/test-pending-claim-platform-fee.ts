/**
 * Unit tests for pending claim platform-fee reuse helpers.
 * Run: npx tsx scripts/test-pending-claim-platform-fee.ts
 */
import assert from 'node:assert/strict'
import {
  claimRetryWithoutRepayMessage,
  clearPendingRevShareClaimPlatformFee,
  isPendingClaimPlatformFeeFresh,
  parsePendingClaimPlatformFee,
  pendingClaimPlatformFeeCovers,
  PENDING_CLAIM_FEE_TTL_MS,
  readPendingRevShareClaimPlatformFee,
  revShareClaimRetryWithoutRepayMessage,
  writePendingRevShareClaimPlatformFee,
} from '../lib/nesting/pending-claim-platform-fee'
import {
  FEE_TX_FAILED_ONCHAIN_ERROR,
  FEE_TX_NOT_FOUND_ERROR,
  isHardPlatformFeeFailureError,
  isRetryableFeeTxLookupError,
} from '../lib/nesting/staking-platform-fee-errors'

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

assert.match(revShareClaimRetryWithoutRepayMessage(1), /rev share was not sent/i)
assert.match(revShareClaimRetryWithoutRepayMessage(19), /19 nest platform fees were paid/i)

// Fee-error classification used by Claim UI to clear vs keep pending localStorage.
assert.equal(isRetryableFeeTxLookupError(FEE_TX_NOT_FOUND_ERROR), true)
assert.equal(isHardPlatformFeeFailureError(FEE_TX_FAILED_ONCHAIN_ERROR), true)

const mem = new Map<string, string>()
const fakeStorage = {
  getItem(key: string) {
    return mem.has(key) ? mem.get(key)! : null
  },
  setItem(key: string, value: string) {
    mem.set(key, value)
  },
  removeItem(key: string) {
    mem.delete(key)
  },
}

writePendingRevShareClaimPlatformFee(
  { wallet: 'W1', signature: 'SigRev', units: 19, savedAtMs: now },
  fakeStorage
)
const loaded = readPendingRevShareClaimPlatformFee(fakeStorage)
assert.ok(loaded)
assert.equal(loaded!.signature, 'SigRev')
assert.equal(loaded!.units, 19)
assert.equal(pendingClaimPlatformFeeCovers(loaded!, 'W1', 19, now), true)
clearPendingRevShareClaimPlatformFee(fakeStorage)
assert.equal(readPendingRevShareClaimPlatformFee(fakeStorage), null)

console.log('pending-claim-platform-fee: ok')
