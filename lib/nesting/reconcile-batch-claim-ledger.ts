import { recordBatchRewardClaims, recordRewardClaim } from '@/lib/db/staking-positions'
import type { StakingRewardExecutionPath } from '@/lib/db/staking-reward-events'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { PositionClaimPlan } from '@/lib/nesting/claim-plan'

export type ClaimLedgerSyncItem = {
  position_id: string
  amount: number
  claimed_rewards_total: number
}

export type SyncBatchClaimLedgerResult = {
  method: 'batch_rpc' | 'per_position' | 'already_synced'
  recorded_count: number
}

function plansToItems(plans: PositionClaimPlan[]): ClaimLedgerSyncItem[] {
  return plans.map((plan) => ({
    position_id: plan.positionId,
    amount: plan.payoutAmount,
    claimed_rewards_total: plan.newClaimedTotal,
  }))
}

async function countClaimEventsForTx(wallet: string, txSig: string): Promise<number> {
  const db = getSupabaseAdmin()
  const { count, error } = await db
    .from('staking_reward_events')
    .select('id', { count: 'exact', head: true })
    .eq('wallet_address', wallet.trim())
    .eq('transaction_signature', txSig.trim())
    .eq('event_type', 'claim')

  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * After OWL was sent on-chain but Claim-all ledger write failed, replay ledger rows (idempotent).
 */
export async function syncBatchClaimLedgerAfterPayout(params: {
  wallet: string
  transaction_signature: string
  items: ClaimLedgerSyncItem[]
  note?: string
  execution_path?: StakingRewardExecutionPath
}): Promise<SyncBatchClaimLedgerResult> {
  const wallet = params.wallet.trim()
  const txSig = params.transaction_signature.trim()
  if (!wallet || !txSig) {
    throw new Error('wallet and transaction_signature are required')
  }
  if (params.items.length === 0) {
    throw new Error('No nest claim rows to sync')
  }

  const existing = await countClaimEventsForTx(wallet, txSig)
  if (existing >= params.items.length) {
    return { method: 'already_synced', recorded_count: existing }
  }

  const note = params.note ?? 'owl_reward_treasury_transfer'
  const executionPath: StakingRewardExecutionPath = params.execution_path ?? 'onchain_transfer'

  try {
    const batch = await recordBatchRewardClaims({
      wallet,
      items: params.items.map((item) => ({
        position_id: item.position_id,
        amount: item.amount,
        new_claimed_total: item.claimed_rewards_total,
      })),
      note,
      transaction_signature: txSig,
      execution_path: executionPath,
    })
    return {
      method: 'batch_rpc',
      recorded_count: batch.recorded_count + batch.idempotent_count,
    }
  } catch (batchErr) {
    console.warn('[syncBatchClaimLedgerAfterPayout] batch RPC failed, trying per-nest', batchErr)
  }

  let recorded = 0
  for (const item of params.items) {
    await recordRewardClaim({
      positionId: item.position_id,
      wallet,
      amount: item.amount,
      newClaimedTotal: item.claimed_rewards_total,
      note,
      transaction_signature: txSig,
      execution_path: executionPath,
    })
    recorded += 1
  }

  return { method: 'per_position', recorded_count: recorded }
}

export function claimPlansToLedgerSyncItems(plans: PositionClaimPlan[]): ClaimLedgerSyncItem[] {
  return plansToItems(plans)
}
