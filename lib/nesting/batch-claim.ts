import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { recordBatchRewardClaims } from '@/lib/db/staking-positions'
import { BatchClaimLedgerSyncError } from '@/lib/nesting/batch-claim-errors'
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

const LEDGER_SYNC_RETRY_ATTEMPTS = 5
const LEDGER_SYNC_RETRY_BASE_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function persistBatchClaimLedger(params: {
  wallet: string
  plans: PositionClaimPlan[]
  note: string
  txSig: string | null
  executionPath: 'onchain_transfer' | 'database_only'
}): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < LEDGER_SYNC_RETRY_ATTEMPTS; attempt++) {
    try {
      await recordBatchRewardClaims({
        wallet: params.wallet,
        items: params.plans.map((plan) => ({
          position_id: plan.positionId,
          amount: plan.payoutAmount,
          new_claimed_total: plan.newClaimedTotal,
        })),
        note: params.note,
        transaction_signature: params.txSig,
        execution_path: params.executionPath,
      })
      return
    } catch (e) {
      lastError = e
      if (attempt < LEDGER_SYNC_RETRY_ATTEMPTS - 1) {
        await sleep(LEDGER_SYNC_RETRY_BASE_MS * (attempt + 1))
      }
    }
  }
  throw lastError
}

/**
 * One SPL transfer for the combined OWL amount, then one atomic DB transaction for all nest rows.
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

  try {
    await persistBatchClaimLedger({
      wallet: params.wallet,
      plans: params.plans,
      note,
      txSig,
      executionPath,
    })
  } catch (e) {
    if (txSig) {
      throw new BatchClaimLedgerSyncError(txSig, e, {
        total_claimed: totalClaimed,
        claims: params.plans.map((plan) => ({
          position_id: plan.positionId,
          claimed: plan.payoutAmount,
          claimed_rewards_total: plan.newClaimedTotal,
        })),
      })
    }
    throw e
  }

  const claims: BatchOwlClaimResult['claims'] = params.plans.map((plan) => ({
    position_id: plan.positionId,
    claimed: plan.payoutAmount,
    claimed_rewards_total: plan.newClaimedTotal,
  }))

  return {
    total_claimed: totalClaimed,
    claims,
    transaction_signature: txSig,
    execution_path: executionPath,
  }
}
