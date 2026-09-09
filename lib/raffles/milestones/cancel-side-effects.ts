import { getRaffleById } from '@/lib/db/raffles'
import { getMilestonesByRaffleId } from '@/lib/db/raffle-milestones'
import { returnMilestoneDepositToCreator } from '@/lib/raffles/milestones/payout'
import { isMilestoneDepositReturnable } from '@/lib/raffles/milestones/return-eligibility'
import { voidMilestonesOnFailedRaffle } from '@/lib/raffles/milestones/settlement'

export type MilestoneDepositReturnAttempt = {
  milestoneId: string
  ok: boolean
  signature?: string
  error?: string
}

/**
 * When a raffle is cancelled or fails min threshold, milestone bonuses must not pay out.
 * Voiding unlocks the same return path used after `failed_refund_available`.
 */
export async function voidMilestonesForTerminalRaffle(raffleId: string): Promise<void> {
  await voidMilestonesOnFailedRaffle(raffleId)
}

/**
 * Best-effort: return prefunded crypto milestone deposits to the creator (funds escrow).
 * Called after cancellation is recorded; failures are logged and surfaced to admin for retry.
 */
export async function returnReturnableMilestoneDepositsToCreator(
  raffleId: string
): Promise<MilestoneDepositReturnAttempt[]> {
  await voidMilestonesForTerminalRaffle(raffleId)

  const raffle = await getRaffleById(raffleId)
  if (!raffle) return []

  const milestones = await getMilestonesByRaffleId(raffleId)
  const results: MilestoneDepositReturnAttempt[] = []

  for (const milestone of milestones) {
    if (!isMilestoneDepositReturnable({ milestone, raffleStatus: raffle.status })) continue

    const result = await returnMilestoneDepositToCreator({ milestone, raffle })
    results.push({
      milestoneId: milestone.id,
      ok: result.ok,
      signature: result.ok ? result.signature : undefined,
      error: result.ok ? undefined : result.error,
    })

    if (!result.ok && result.error) {
      console.warn(
        `[milestone-cancel-return] Deposit return failed for milestone ${milestone.id} on raffle ${raffleId}: ${result.error}`
      )
    }
  }

  return results
}
