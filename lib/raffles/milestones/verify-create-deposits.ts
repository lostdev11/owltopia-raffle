import { verifyBuyoutDepositTx } from '@/lib/verify-buyout-deposit'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { getMilestonesByRaffleId, updateRaffleMilestone } from '@/lib/db/raffle-milestones'
import { maybePublishRaffleAfterDeposits } from '@/lib/raffles/publish-after-deposits'
import {
  pendingCryptoMilestonesForCreate,
  sumMilestoneDepositsByCurrency,
  type MilestoneDepositCurrency,
} from '@/lib/raffles/milestones/create-deposit-totals'

export type VerifyCreateMilestoneDepositsResult =
  | { ok: true; depositVerifiedAt: string; published: boolean; milestoneIds: string[] }
  | { ok: false; error: string; httpStatus?: number }

/**
 * Verify one create-time tx that prefunded all pending crypto milestones for a currency
 * (combined transfer to funds escrow).
 */
export async function verifyCreateMilestoneDepositsInternal(params: {
  raffleId: string
  depositTx: string
  creatorWallet: string
  currency: MilestoneDepositCurrency
}): Promise<VerifyCreateMilestoneDepositsResult> {
  const milestones = await getMilestonesByRaffleId(params.raffleId)
  const pending = pendingCryptoMilestonesForCreate(milestones).filter(
    (m) => m.prize_currency === params.currency
  )
  if (pending.length === 0) {
    return { ok: true, depositVerifiedAt: new Date().toISOString(), published: false, milestoneIds: [] }
  }

  const escrow = getFundsEscrowPublicKey()
  if (!escrow) {
    return { ok: false, error: 'Funds escrow is not configured.', httpStatus: 503 }
  }

  const totals = sumMilestoneDepositsByCurrency(pending)
  const expectedAmount = totals[params.currency] ?? 0
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return { ok: false, error: 'Invalid milestone deposit total.', httpStatus: 400 }
  }

  const verify = await verifyBuyoutDepositTx({
    transactionSignature: params.depositTx.trim(),
    bidderWallet: params.creatorWallet.trim(),
    depositWallet: escrow,
    expectedAmount,
    currency: params.currency,
    allowOlderThanHour: true,
  })

  if (!verify.valid) {
    return { ok: false, error: verify.error ?? 'Milestone deposit verification failed.', httpStatus: 400 }
  }

  const now = new Date().toISOString()
  const tx = params.depositTx.trim()
  for (const m of pending) {
    await updateRaffleMilestone(m.id, {
      deposit_tx: tx,
      deposit_verified_at: now,
    })
  }

  const published = await maybePublishRaffleAfterDeposits(params.raffleId)
  return {
    ok: true,
    depositVerifiedAt: now,
    published,
    milestoneIds: pending.map((m) => m.id),
  }
}
