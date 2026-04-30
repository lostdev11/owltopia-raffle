/**
 * Ensures cart batch gross ↔ merged split invariant helpers behave as expected.
 * Run: npx tsx scripts/test-batch-cart-invariants.ts
 */
import assert from 'node:assert/strict'
import {
  assertCartBatchGrossMatchesMergedSplit,
  CartBatchPaymentTotalMismatchError,
} from '../lib/entries/batch-invariants'

assertCartBatchGrossMatchesMergedSplit({
  lineGrossAmounts: [1.5, 2.5],
  mergedSplit: [{ amount: 4 }],
})

assert.throws(
  () =>
    assertCartBatchGrossMatchesMergedSplit({
      lineGrossAmounts: [1, 2],
      mergedSplit: [{ amount: 2.99 }],
    }),
  CartBatchPaymentTotalMismatchError
)

assert.throws(
  () =>
    assertCartBatchGrossMatchesMergedSplit({
      lineGrossAmounts: [1, Number.NaN],
      mergedSplit: [{ amount: 1 }],
    }),
  CartBatchPaymentTotalMismatchError
)

console.log('batch-cart-invariants: ok')
