/**
 * Cover an on-chain rev-share pool shortfall without raising claimable period books.
 *
 * "Deposit Gen 1/2" credits period totals (liability ↑ with the pool). That cannot close a
 * hole where books already exceed the wallet. Coverage top-ups only move SOL into the pool.
 */

import { getGenOwlRevSharePoolPublicKey } from '@/lib/nesting/gen-owl-rev-share-pool'
import { loadGenOwlRevShareLiabilityWithCoverage } from '@/lib/nesting/gen-owl-rev-share-liability-service'
import { verifyGenOwlRevSharePoolDepositTx } from '@/lib/nesting/verify-gen-owl-rev-share-deposit'
import { StakingUserError } from '@/lib/nesting/errors'
import {
  GEN_OWL_REV_SHARE_COVER_SHORTFALL_BUFFER_SOL,
  suggestedGenOwlRevShareCoverShortfallSol,
} from '@/lib/nesting/gen-owl-rev-share-cover-shortfall-amount'

export {
  GEN_OWL_REV_SHARE_COVER_SHORTFALL_BUFFER_SOL,
  suggestedGenOwlRevShareCoverShortfallSol,
}

/**
 * Verify a connected-wallet SOL transfer into the pool that does NOT credit period totals.
 */
export async function confirmGenOwlRevShareCoverageTopUp(params: {
  depositorWallet: string
  amount_sol: number
  sol_signature: string
  allow_older_tx?: boolean
}): Promise<{
  amount_sol: number
  sol_signature: string
  pool_address: string
  shortfall_sol_before: number
  pool_covered_after: boolean
  shortfall_sol_after: number
}> {
  const poolWallet = getGenOwlRevSharePoolPublicKey()
  if (!poolWallet) {
    throw new StakingUserError(
      'Rev share pool is not configured. Set GEN_OWL_REV_SHARE_POOL_SECRET_KEY.',
      503
    )
  }

  const amount = Number(params.amount_sol)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new StakingUserError('Enter a positive SOL amount to cover the shortfall.', 400)
  }
  if (amount > 100) {
    throw new StakingUserError('Coverage top-up exceeds max of 100 SOL per tx.', 400)
  }

  const sig = params.sol_signature?.trim()
  if (!sig) {
    throw new StakingUserError('SOL coverage transaction signature is required.', 400)
  }

  const before = await loadGenOwlRevShareLiabilityWithCoverage()

  const verified = await verifyGenOwlRevSharePoolDepositTx({
    transactionSignature: sig,
    depositorWallet: params.depositorWallet.trim(),
    poolWallet,
    expectedAmount: amount,
    currency: 'SOL',
    allowOlderThanHour: Boolean(params.allow_older_tx),
  })
  if (!verified.valid) {
    throw new StakingUserError(verified.error || 'Coverage top-up verification failed.', 400)
  }

  const after = await loadGenOwlRevShareLiabilityWithCoverage()
  return {
    amount_sol: amount,
    sol_signature: sig,
    pool_address: poolWallet,
    shortfall_sol_before: before.coverage.shortfall_sol,
    pool_covered_after: after.coverage.ok,
    shortfall_sol_after: after.coverage.shortfall_sol,
  }
}
