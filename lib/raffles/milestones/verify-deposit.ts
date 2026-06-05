import { verifyBuyoutDepositTx } from '@/lib/verify-buyout-deposit'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { getMilestoneById, updateRaffleMilestone } from '@/lib/db/raffle-milestones'
import { getRaffleById } from '@/lib/db/raffles'
import { maybePublishRaffleAfterDeposits } from '@/lib/raffles/publish-after-deposits'

export type VerifyMilestoneDepositResult =
  | { ok: true; depositVerifiedAt: string; published: boolean }
  | { ok: false; error: string; httpStatus?: number }

export async function verifyMilestoneDepositInternal(params: {
  milestoneId: string
  depositTx: string
  creatorWallet: string
}): Promise<VerifyMilestoneDepositResult> {
  const milestone = await getMilestoneById(params.milestoneId)
  if (!milestone) {
    return { ok: false, error: 'Milestone not found', httpStatus: 404 }
  }
  if (milestone.prize_type !== 'crypto') {
    return { ok: false, error: 'Only crypto milestone deposits are supported in this version.', httpStatus: 400 }
  }
  if (milestone.deposit_verified_at) {
    return { ok: true, depositVerifiedAt: milestone.deposit_verified_at, published: false }
  }

  const raffle = await getRaffleById(milestone.raffle_id)
  if (!raffle) {
    return { ok: false, error: 'Raffle not found', httpStatus: 404 }
  }

  const escrow = getFundsEscrowPublicKey()
  if (!escrow) {
    return { ok: false, error: 'Funds escrow is not configured.', httpStatus: 503 }
  }

  const amount = Number(milestone.prize_amount ?? 0)
  const currency = milestone.prize_currency
  if (!currency || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Invalid milestone prize amount.', httpStatus: 400 }
  }

  const verify = await verifyBuyoutDepositTx({
    transactionSignature: params.depositTx.trim(),
    bidderWallet: params.creatorWallet.trim(),
    depositWallet: escrow,
    expectedAmount: amount,
    currency,
    allowOlderThanHour: true,
  })

  if (!verify.valid) {
    return { ok: false, error: verify.error ?? 'Deposit verification failed.', httpStatus: 400 }
  }

  const now = new Date().toISOString()
  await updateRaffleMilestone(milestone.id, {
    deposit_tx: params.depositTx.trim(),
    deposit_verified_at: now,
  })

  const published = await maybePublishRaffleAfterDeposits(milestone.raffle_id)
  return { ok: true, depositVerifiedAt: now, published }
}
