import type { Raffle, RaffleMilestone } from '@/lib/types'
import { payoutCryptoFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import { updateRaffleMilestone } from '@/lib/db/raffle-milestones'

export async function claimMilestoneCryptoPrize(params: {
  milestone: RaffleMilestone
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
  const currency = m.prize_currency
  const result = await payoutCryptoFromFundsEscrow({
    recipientWallet: params.winnerWallet.trim(),
    amount,
    currency,
  })
  if (!result.ok) {
    return { ok: false, error: 'error' in result ? result.error : 'Payout failed.' }
  }
  if (!result.signature) {
    return { ok: false, error: 'Payout failed.' }
  }

  const now = new Date().toISOString()
  await updateRaffleMilestone(m.id, {
    status: 'claimed',
    claim_tx: result.signature,
    claimed_at: now,
  })
  return { ok: true, signature: result.signature }
}

export async function returnMilestoneDepositToCreator(params: {
  milestone: RaffleMilestone
  raffle: Pick<Raffle, 'creator_wallet' | 'created_by'>
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const m = params.milestone
  if (m.prize_type !== 'crypto' || !m.prize_currency) {
    return { ok: false, error: 'Only crypto milestone returns are supported in this version.' }
  }
  if (m.status !== 'void' && m.status !== 'pending' && m.status !== 'unlocked') {
    if (m.returned_at && m.return_tx) {
      return { ok: true, signature: m.return_tx }
    }
    if (m.status === 'awarded' || m.status === 'claimed') {
      return { ok: false, error: 'Milestone was awarded; cannot return deposit.' }
    }
  }
  if (!m.deposit_verified_at) {
    return { ok: false, error: 'No verified milestone deposit to return.' }
  }
  if (m.returned_at && m.return_tx) {
    return { ok: true, signature: m.return_tx }
  }

  const creator = (params.raffle.creator_wallet || params.raffle.created_by || '').trim()
  if (!creator) {
    return { ok: false, error: 'Raffle has no creator wallet.' }
  }

  const amount = Number(m.prize_amount ?? 0)
  const result = await payoutCryptoFromFundsEscrow({
    recipientWallet: creator,
    amount,
    currency: m.prize_currency,
  })
  if (!result.ok) {
    return { ok: false, error: 'error' in result ? result.error : 'Return transfer failed.' }
  }
  if (!result.signature) {
    return { ok: false, error: 'Return transfer failed.' }
  }

  const now = new Date().toISOString()
  await updateRaffleMilestone(m.id, {
    status: 'returned',
    return_tx: result.signature,
    returned_at: now,
  })
  return { ok: true, signature: result.signature }
}
