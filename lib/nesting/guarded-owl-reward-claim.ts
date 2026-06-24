import type { StakingPoolRow } from '@/lib/db/staking-pools'
import {
  beginOwlRewardTransferGuard,
  markOwlRewardTransferFailed,
  markOwlRewardTransferRecorded,
  markOwlRewardTransferSent,
} from '@/lib/db/staking-owl-reward-transfers'
import { resolveRewardClaimRecording } from '@/lib/nesting/reward-claim-record'
import { tryTransferOwlRewardClaim } from '@/lib/nesting/owl-reward-claim-transfer'

export type GuardedClaimRecording = {
  txSig: string | null
  note: string
  executionPath: 'onchain_transfer' | 'database_only'
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Sends an OWL reward payout behind a durable, per-wallet guard, then records the
 * ledger via `recordLedger`. If the on-chain transfer succeeds but `recordLedger`
 * fails, the guard row is intentionally left in the blocking `sent` state so the
 * payout cannot be silently re-sent on retry (treasury protection) — callers
 * surface this as a recoverable sync error and admin reconciliation clears it.
 */
export async function runGuardedOwlRewardClaim<T>(params: {
  wallet: string
  positionIds: string[]
  pool: StakingPoolRow
  claimAmountUi: number
  recordLedger: (recording: GuardedClaimRecording) => Promise<T>
}): Promise<{ value: T } & GuardedClaimRecording> {
  const guardId = await beginOwlRewardTransferGuard({
    wallet: params.wallet,
    positionIds: params.positionIds,
    amountUi: params.claimAmountUi,
  })

  let recording: GuardedClaimRecording
  try {
    const transfer = await tryTransferOwlRewardClaim({
      pool: params.pool,
      recipientWallet: params.wallet,
      claimAmountUi: params.claimAmountUi,
    })
    const { txSig, note } = resolveRewardClaimRecording({
      poolRewardToken: params.pool.reward_token,
      transfer,
      claimAmountUi: params.claimAmountUi,
    })
    recording = { txSig, note, executionPath: txSig ? 'onchain_transfer' : 'database_only' }
  } catch (e) {
    // No OWL was sent (transfer threw, failed, or was rejected before sending): release the guard.
    await markOwlRewardTransferFailed(guardId, errText(e)).catch(() => {})
    throw e
  }

  if (recording.txSig) {
    await markOwlRewardTransferSent(guardId, recording.txSig)
  }

  let value: T
  try {
    value = await params.recordLedger(recording)
  } catch (e) {
    // OWL already left the treasury: keep the guard blocking (status='sent') so a
    // retry cannot re-send. Only release it when nothing was sent on-chain.
    if (!recording.txSig) {
      await markOwlRewardTransferFailed(guardId, errText(e)).catch(() => {})
    }
    throw e
  }

  await markOwlRewardTransferRecorded(guardId).catch(() => {})
  return { value, ...recording }
}
