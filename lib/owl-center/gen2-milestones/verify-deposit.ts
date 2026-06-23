import { verifyBuyoutDepositTx } from '@/lib/verify-buyout-deposit'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { getGen2MilestoneById, updateGen2Milestone } from '@/lib/db/gen2-mint-milestones'

export type VerifyGen2MilestoneDepositResult =
  | { ok: true; depositVerifiedAt: string }
  | { ok: false; error: string; httpStatus?: number }

/**
 * Verify the funder's on-chain deposit into the funds escrow covering this
 * milestone's prize, and mark the milestone funded.
 */
export async function verifyGen2MilestoneDepositInternal(params: {
  milestoneId: string
  depositTx: string
  funderWallet: string
}): Promise<VerifyGen2MilestoneDepositResult> {
  const milestone = await getGen2MilestoneById(params.milestoneId)
  if (!milestone) {
    return { ok: false, error: 'Milestone not found', httpStatus: 404 }
  }
  if (milestone.prize_type !== 'crypto') {
    return { ok: false, error: 'Only crypto milestone deposits are supported.', httpStatus: 400 }
  }
  if (milestone.deposit_verified_at) {
    return { ok: true, depositVerifiedAt: milestone.deposit_verified_at }
  }
  if (milestone.status !== 'pending') {
    return { ok: false, error: 'Milestone is no longer awaiting funding.', httpStatus: 400 }
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
    bidderWallet: params.funderWallet.trim(),
    depositWallet: escrow,
    expectedAmount: amount,
    currency,
    allowOlderThanHour: true,
  })

  if (!verify.valid) {
    return { ok: false, error: verify.error ?? 'Deposit verification failed.', httpStatus: 400 }
  }

  const now = new Date().toISOString()
  await updateGen2Milestone(milestone.id, {
    deposit_tx: params.depositTx.trim(),
    deposit_verified_at: now,
    funded_by_wallet: milestone.funded_by_wallet || params.funderWallet.trim(),
  })

  return { ok: true, depositVerifiedAt: now }
}
