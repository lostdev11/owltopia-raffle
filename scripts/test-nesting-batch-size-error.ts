/**
 * Regression: multi-NFT nest lock size failures (incl. Phantom Lighthouse inflation)
 * must be detected so the UI can halve / retry instead of forcing users to nest one-by-one.
 * Run: npx tsx scripts/test-nesting-batch-size-error.ts
 */
import assert from 'node:assert/strict'
import {
  isNestingBatchSizeError,
  isNestingWalletUserRejection,
} from '../lib/nesting/wallet-error'

function main() {
  assert.equal(isNestingBatchSizeError(new Error('Transaction too large')), true)
  assert.equal(isNestingBatchSizeError(new Error('VersionedTransaction too large')), true)
  assert.equal(isNestingBatchSizeError(new Error('encoding overruns Uint8Array')), true)
  assert.equal(
    isNestingBatchSizeError(new Error('Simulation failed: transaction too large after Lighthouse')),
    true
  )
  assert.equal(
    isNestingBatchSizeError(new Error('Lighthouse injection exceeded size limit')),
    true
  )
  assert.equal(isNestingBatchSizeError(new Error('max accounts exceeded')), true)
  assert.equal(
    isNestingBatchSizeError(new Error('Computational budget exceeded')),
    true
  )

  // Do not treat cancel / reject as size — that would spam wallet prompts.
  assert.equal(isNestingWalletUserRejection(new Error('User rejected the request')), true)
  assert.equal(isNestingBatchSizeError(new Error('User rejected the request')), false)
  assert.equal(isNestingBatchSizeError(new Error('Transaction cancelled')), false)

  // Generic sim failure without size cues stays a hard error (surface to user).
  assert.equal(isNestingBatchSizeError(new Error('Simulation failed: custom program error: 0x1a')), false)

  console.log(JSON.stringify({ ok: true, nestingBatchSizeError: true }, null, 2))
}

main()
