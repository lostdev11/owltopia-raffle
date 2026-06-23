import type { Gen2MintMilestone } from '@/lib/types'
import { payoutCryptoFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import { updateGen2Milestone } from '@/lib/db/gen2-mint-milestones'

export async function claimGen2MilestonePrize(params: {
  milestone: Gen2MintMilestone
  winnerWallet: string
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const m = params.milestone
  if (m.prize_type !== 'crypto' || !m.prize_currency) {
    return { ok: false, error: 'This milestone is not a crypto prize.' }
  }
  if (m.status !== 'awarded') {
    return { ok: false, error: 'Milestone prize is not ready to claim.' }
  }
  if (!m.winner_wallet || m.winner_wallet.trim() !== params.winnerWallet.trim()) {
    return { ok: false, error: 'Only the milestone winner can claim this prize.' }
  }
  if (m.claimed_at && m.claim_tx) {
    return { ok: true, signature: m.claim_tx }
  }

  const amount = Number(m.prize_amount ?? 0)
  const result = await payoutCryptoFromFundsEscrow({
    recipientWallet: params.winnerWallet.trim(),
    amount,
    currency: m.prize_currency,
  })
  if (!result.ok || !result.signature) {
    return { ok: false, error: 'error' in result ? result.error : 'Payout failed.' }
  }

  const now = new Date().toISOString()
  await updateGen2Milestone(m.id, {
    status: 'claimed',
    claim_tx: result.signature,
    claimed_at: now,
  })
  return { ok: true, signature: result.signature }
}

/** Return a void/unclaimed milestone deposit to the wallet that funded it. */
export async function returnGen2MilestoneDeposit(params: {
  milestone: Gen2MintMilestone
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const m = params.milestone
  if (m.prize_type !== 'crypto' || !m.prize_currency) {
    return { ok: false, error: 'Only crypto milestone returns are supported.' }
  }
  if (m.status === 'awarded' || m.status === 'claimed') {
    return { ok: false, error: 'Milestone was awarded; cannot return deposit.' }
  }
  if (!m.deposit_verified_at) {
    return { ok: false, error: 'No verified milestone deposit to return.' }
  }
  if (m.returned_at && m.return_tx) {
    return { ok: true, signature: m.return_tx }
  }

  const recipient = (m.funded_by_wallet || '').trim()
  if (!recipient) {
    return { ok: false, error: 'No funder wallet recorded for this milestone.' }
  }

  const amount = Number(m.prize_amount ?? 0)
  const result = await payoutCryptoFromFundsEscrow({
    recipientWallet: recipient,
    amount,
    currency: m.prize_currency,
  })
  if (!result.ok || !result.signature) {
    return { ok: false, error: 'error' in result ? result.error : 'Return transfer failed.' }
  }

  const now = new Date().toISOString()
  await updateGen2Milestone(m.id, {
    status: 'returned',
    return_tx: result.signature,
    returned_at: now,
  })
  return { ok: true, signature: result.signature }
}
