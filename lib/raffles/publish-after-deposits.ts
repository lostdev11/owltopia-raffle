import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { allMilestonesDeposited, getMilestonesByRaffleId } from '@/lib/db/raffle-milestones'
import { recordModerationStrikeOnPublish } from '@/lib/db/creator-moderation'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import {
  raffleModerationListingFeePaid,
  raffleRequiresModerationListingFee,
} from '@/lib/raffles/creator-moderation-policy'

/**
 * Publish raffle (live + active) once main prize, milestones, and moderation listing fee are verified.
 */
export async function maybePublishRaffleAfterDeposits(raffleId: string): Promise<boolean> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) return false
  if (raffle.status !== 'draft') {
    return raffle.is_active === true
  }

  const needsPrizeEscrow =
    raffle.prize_type === 'nft' || isPartnerSplPrizeRaffle(raffle)
  if (needsPrizeEscrow && !raffle.prize_deposited_at) return false

  const milestones = await getMilestonesByRaffleId(raffleId)
  if (milestones.length > 0 && !(await allMilestonesDeposited(raffleId))) return false

  if (raffleRequiresModerationListingFee(raffle)) return false
  if (
    raffle.creator_restricted_listing &&
    (raffle.moderation_listing_fee_lamports ?? 0) > 0 &&
    !raffleModerationListingFeePaid(raffle)
  ) {
    return false
  }

  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  if (
    raffle.creator_restricted_listing &&
    creatorWallet &&
    raffleModerationListingFeePaid(raffle)
  ) {
    await recordModerationStrikeOnPublish({
      walletAddress: creatorWallet,
      raffleId,
      listingFeeLamports: raffle.moderation_listing_fee_lamports ?? 0,
      listingFeePaymentTx: raffle.moderation_listing_fee_payment_tx ?? null,
    })
  }

  const now = new Date().toISOString()
  await updateRaffle(raffleId, {
    is_active: true,
    status: 'live',
    updated_at: now,
  })
  return true
}

/** After prize escrow verify: keep draft until milestone escrows and moderation fee are also verified. */
export async function finalizeRafflePublicationAfterPrizeVerify(raffleId: string): Promise<void> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) return

  const milestones = await getMilestonesByRaffleId(raffleId)
  const milestonesPending = milestones.length > 0 && !(await allMilestonesDeposited(raffleId))
  const moderationPending = raffleRequiresModerationListingFee(raffle)

  if (milestonesPending || moderationPending) {
    await updateRaffle(raffleId, { is_active: false, status: 'draft' })
  }
  await maybePublishRaffleAfterDeposits(raffleId)
}

export async function raffleHasPendingMilestoneDeposits(raffleId: string): Promise<boolean> {
  const milestones = await getMilestonesByRaffleId(raffleId)
  if (milestones.length === 0) return false
  return !(await allMilestonesDeposited(raffleId))
}
