import { StakingUserError } from '@/lib/nesting/errors'
import type { OwlRewardClaimTransferOutcome } from '@/lib/nesting/owl-reward-claim-transfer'
import { isNestingDbOnlyOwlClaimsAllowed } from '@/lib/nesting/policy'

/**
 * Decide how to persist a claim after `tryTransferOwlRewardClaim`.
 * OWL pools: never bump `claimed_rewards` unless the SPL transfer succeeded, except when
 * `NESTING_ALLOW_DB_ONLY_OWL_CLAIMS` is set (local / explicit ledger-only mode).
 */
export function resolveRewardClaimRecording(params: {
  poolRewardToken: string | null | undefined
  transfer: OwlRewardClaimTransferOutcome
  claimAmountUi: number
}): { txSig: string | null; note: string } {
  const isOwlPool = (params.poolRewardToken ?? '').trim().toUpperCase() === 'OWL'

  if (params.transfer.kind === 'failed') {
    throw new StakingUserError(params.transfer.error, 503)
  }

  if (!isOwlPool) {
    const txSig = params.transfer.kind === 'sent' ? params.transfer.signature : null
    return {
      txSig,
      note: params.transfer.kind === 'sent' ? 'owl_reward_treasury_transfer' : 'mvp_db_claim',
    }
  }

  if (params.transfer.kind === 'sent') {
    return { txSig: params.transfer.signature, note: 'owl_reward_treasury_transfer' }
  }

  if (params.transfer.kind === 'skipped' && params.transfer.reason === 'zero_amount' && params.claimAmountUi > 1e-12) {
    throw new StakingUserError(
      'Claim amount is too small to send on-chain with current OWL decimals. Wait for more rewards to accrue, then try again.',
      400
    )
  }

  if (params.transfer.kind === 'skipped' && isNestingDbOnlyOwlClaimsAllowed()) {
    return { txSig: null, note: 'db_only_owl_claim' }
  }

  if (params.transfer.kind === 'skipped') {
    throw new StakingUserError(
      'OWL could not be sent to your wallet (treasury transfer was skipped). For production, configure and fund NESTING_OWL_REWARD_TREASURY_WALLET with NESTING_OWL_REWARD_TREASURY_SECRET_KEY. For local testing only, set NESTING_ALLOW_DB_ONLY_OWL_CLAIMS=true.',
      503,
      { skip_reason: params.transfer.reason }
    )
  }

  throw new StakingUserError('Unexpected reward transfer outcome', 500)
}
