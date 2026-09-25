/**
 * SOL crypto prize payouts prefer wSOL (post-verify wrap) then native SOL fallback.
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

/** Mirrors payoutSolPartnerPrizeFromEscrowToRecipient preference order. */
function preferSolPrizeError(
  wsolError: string | undefined,
  nativeError: string | undefined
): 'wsol' | 'native' {
  if (nativeError?.includes('Escrow SOL balance is below')) return 'native'
  if (splSolPayoutFailureShouldTryNativeFallback(wsolError)) return 'native'
  return 'wsol'
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

assert.equal(
  preferSolPrizeError(
    'Escrow does not hold this token (tried SPL Token and Token-2022)',
    'Escrow SOL balance is below the prize amount (have ~0.5209 SOL, need ~1.0000 SOL'
  ),
  'native',
  'shared-wallet drain message must win when both paths fail'
)

assert.equal(
  preferSolPrizeError('Escrow token account balance is below the prize amount on-chain.', undefined),
  'native'
)

console.log('sol-prize-payout-path: ok')
