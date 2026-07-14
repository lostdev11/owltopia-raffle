/**
 * Unit checks for refund amount display / zero-payment detection.
 * Run: npx --yes tsx scripts/test-entry-refund-amount.ts
 */
import {
  entryHasOnChainRefundAmount,
  formatRefundClaimAmount,
  formatRefundClaimButtonLabel,
  noPaymentRefundSignature,
} from '../lib/raffles/entry-refund-amount'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

assert(entryHasOnChainRefundAmount({ amount_paid: 0.001 }) === true, '0.001 should refund')
assert(entryHasOnChainRefundAmount({ amount_paid: 0 }) === false, '0 should not refund on-chain')
assert(
  entryHasOnChainRefundAmount({ amount_paid: 1, referral_complimentary: true }) === false,
  'complimentary never on-chain refunds'
)
assert(formatRefundClaimAmount(0, 'SOL') === '0 SOL', 'zero format')
assert(formatRefundClaimAmount(0.001, 'SOL') === '0.001 SOL', '0.001 format')
assert(formatRefundClaimAmount(0.000001, 'SOL') === '0.000001 SOL', 'dust format not 0.0000')
assert(formatRefundClaimAmount(0.1, 'SOL') === '0.1 SOL', '0.1 trim')
assert(formatRefundClaimAmount(1.25, 'USDC') === '1.25 USDC', 'usdc')
assert(formatRefundClaimButtonLabel({ amount_paid: 0 }) === 'Close free ticket', 'free label')
assert(
  formatRefundClaimButtonLabel({ amount_paid: 0.001, currency: 'SOL' }) === 'Claim 0.001 SOL',
  'paid label'
)
assert(noPaymentRefundSignature('abc').startsWith('NO_PAYMENT:'), 'synthetic sig')

console.log('ok: entry-refund-amount')
