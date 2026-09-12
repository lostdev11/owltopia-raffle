/**
 * SOL crypto prize payouts should prefer native SOL (creator deposit path) before wSOL SPL.
 * Run: npx tsx scripts/test-sol-prize-payout-path.ts
 */
import assert from 'node:assert/strict'

function splSolPayoutFailureShouldTryNativeFallback(error: string | undefined): boolean {
  if (!error) return false
  return (
    error.includes('Escrow does not hold this token') ||
    error.includes('Could not read the escrow token account') ||
    error.includes('Escrow token account balance is below')
  )
}

assert.equal(
  splSolPayoutFailureShouldTryNativeFallback(
    'Could not read the escrow token account for this mint on-chain.'
  ),
  true
)
assert.equal(
  splSolPayoutFailureShouldTryNativeFallback(
    'Escrow does not hold this token (tried SPL Token and Token-2022)'
  ),
  true
)
assert.equal(splSolPayoutFailureShouldTryNativeFallback('Your wallet rejected the transaction.'), false)

console.log('sol-prize-payout-path: ok')
