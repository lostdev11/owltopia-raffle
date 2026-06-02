import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { allMilestonesDeposited, getMilestonesByRaffleId } from '@/lib/db/raffle-milestones'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'

/**
 * Publish raffle (live + active) once main prize and all milestone escrows are verified.
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

  const now = new Date().toISOString()
  await updateRaffle(raffleId, {
    is_active: true,
    status: 'live',
    updated_at: now,
  })
  return true
}

/** After prize escrow verify: keep draft until milestone escrows are also verified. */
export async function finalizeRafflePublicationAfterPrizeVerify(raffleId: string): Promise<void> {
  const milestones = await getMilestonesByRaffleId(raffleId)
  if (milestones.length > 0 && !(await allMilestonesDeposited(raffleId))) {
    await updateRaffle(raffleId, { is_active: false, status: 'draft' })
  }
  await maybePublishRaffleAfterDeposits(raffleId)
}

export async function raffleHasPendingMilestoneDeposits(raffleId: string): Promise<boolean> {
  const milestones = await getMilestonesByRaffleId(raffleId)
  if (milestones.length === 0) return false
  return !(await allMilestonesDeposited(raffleId))
}
