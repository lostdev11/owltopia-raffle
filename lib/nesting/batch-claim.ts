import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { recordRewardClaim } from '@/lib/db/staking-positions'
import { tryTransferOwlRewardClaim } from '@/lib/nesting/owl-reward-claim-transfer'
import { resolveRewardClaimRecording } from '@/lib/nesting/reward-claim-record'
import type { PositionClaimPlan } from '@/lib/nesting/claim-plan'

export type BatchOwlClaimResult = {
  total_claimed: number
  claims: Array<{
    position_id: string
    claimed: number
    claimed_rewards_total: number
  }>
  transaction_signature: string | null
  execution_path: 'onchain_transfer' | 'database_only'
}

/**
 * One SPL transfer for the combined OWL amount, then per-nest ledger rows sharing that signature.
 */
export async function executeBatchOwlClaims(params: {
  wallet: string
  pool: StakingPoolRow
  plans: PositionClaimPlan[]
}): Promise<BatchOwlClaimResult> {
  const totalClaimed = params.plans.reduce((sum, p) => sum + p.payoutAmount, 0)
  if (totalClaimed <= 0) {
    return { total_claimed: 0, claims: [], transaction_signature: null, execution_path: 'database_only' }
  }

  const transfer = await tryTransferOwlRewardClaim({
    pool: params.pool,
    recipientWallet: params.wallet,
    claimAmountUi: totalClaimed,
  })
  const { txSig, note } = resolveRewardClaimRecording({
    poolRewardToken: params.pool.reward_token,
    transfer,
    claimAmountUi: totalClaimed,
  })
  const executionPath = txSig ? ('onchain_transfer' as const) : ('database_only' as const)

  const claims: BatchOwlClaimResult['claims'] = []
  for (const plan of params.plans) {
    await recordRewardClaim({
      positionId: plan.positionId,
      wallet: params.wallet,
      amount: plan.payoutAmount,
      newClaimedTotal: plan.newClaimedTotal,
      note,
      transaction_signature: txSig,
      execution_path: executionPath,
    })
    claims.push({
      position_id: plan.positionId,
      claimed: plan.payoutAmount,
      claimed_rewards_total: plan.newClaimedTotal,
    })
  }

  return {
    total_claimed: totalClaimed,
    claims,
    transaction_signature: txSig,
    execution_path: executionPath,
  }
}
