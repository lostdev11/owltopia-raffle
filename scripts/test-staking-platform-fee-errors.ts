/**
 * Unit tests for platform-fee verify error classification + split messages.
 * Run: npx tsx scripts/test-staking-platform-fee-errors.ts
 */
import assert from 'node:assert/strict'
import {
  FEE_TX_FAILED_ONCHAIN_ERROR,
  FEE_TX_NOT_FOUND_ERROR,
  FEE_TX_NOT_FOUND_OR_FAILED_LEGACY_ERROR,
  isHardPlatformFeeFailureError,
  isRetryableFeeTxLookupError,
} from '../lib/nesting/staking-platform-fee-errors'

assert.equal(isRetryableFeeTxLookupError(FEE_TX_NOT_FOUND_ERROR), true)
assert.equal(isHardPlatformFeeFailureError(FEE_TX_NOT_FOUND_ERROR), false)

assert.equal(isRetryableFeeTxLookupError(FEE_TX_FAILED_ONCHAIN_ERROR), false)
assert.equal(isHardPlatformFeeFailureError(FEE_TX_FAILED_ONCHAIN_ERROR), true)

assert.equal(isRetryableFeeTxLookupError(FEE_TX_NOT_FOUND_OR_FAILED_LEGACY_ERROR), true)
assert.equal(isHardPlatformFeeFailureError(FEE_TX_NOT_FOUND_OR_FAILED_LEGACY_ERROR), false)

assert.equal(
  isHardPlatformFeeFailureError('Fee transaction was not signed by your connected wallet.'),
  true
)
assert.equal(isHardPlatformFeeFailureError('Platform treasury was not credited in this transaction.'), true)
assert.equal(
  isHardPlatformFeeFailureError('Platform fee too low: need at least 0.0065 SOL for 65 nest(s).'),
  true
)
assert.equal(
  isRetryableFeeTxLookupError('Rev share pool cannot cover this payout right now.'),
  false
)
assert.equal(
  isHardPlatformFeeFailureError('Rev share pool cannot cover this payout right now.'),
  false
)

// Split messages must stay distinct (client clears pending only on hard failures).
assert.notEqual(FEE_TX_NOT_FOUND_ERROR, FEE_TX_FAILED_ONCHAIN_ERROR)
assert.match(FEE_TX_NOT_FOUND_ERROR, /not found yet/i)
assert.match(FEE_TX_FAILED_ONCHAIN_ERROR, /failed on-chain/i)
assert.match(FEE_TX_FAILED_ONCHAIN_ERROR, /Approve a new platform fee/i)

console.log('test-staking-platform-fee-errors: ok')
