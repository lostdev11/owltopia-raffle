import type { Gen2MintMilestone } from '@/lib/types'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import {
  getGen2MilestonesByLaunchId,
  getPriorGen2MilestoneWinnerWallets,
  transitionGen2MilestoneStatus,
  updateGen2Milestone,
} from '@/lib/db/gen2-mint-milestones'
import { pickRandomWalletWeighted, pickTopBuyerWallet } from '@/lib/raffles/milestones/draw'
import { aggregateMinterWallets } from '@/lib/owl-center/gen2-milestones/aggregate'
import { gen2MilestoneTargetMints } from '@/lib/owl-center/gen2-milestones/target'

/**
 * Evaluate all milestones for a launch against the current mint count.
 *
 * For each pending milestone whose target has been crossed:
 *  - funded (deposit verified)  -> unlock + auto-award a weighted-random / top minter
 *  - not funded in time         -> void (deposit, if any, becomes returnable)
 *
 * Idempotent & race-safe: status transitions are guarded by optimistic
 * compare-and-set so concurrent confirm-mint calls can't double-award.
 *
 * Best-effort: callers should not let a failure here break the mint response.
 */
export async function evaluateGen2MintMilestones(
  launch: Pick<OwlCenterLaunchPublic, 'id' | 'total_supply' | 'minted_count'>
): Promise<Gen2MintMilestone[]> {
  const milestones = await getGen2MilestonesByLaunchId(launch.id)
  if (milestones.length === 0) return []

  const mintedCount = Number(launch.minted_count ?? 0)
  const totalSupply = Number(launch.total_supply ?? 0)

  const crossedPending = milestones.filter(
    (m) =>
      m.status === 'pending' &&
      mintedCount >= gen2MilestoneTargetMints(m, totalSupply)
  )
  if (crossedPending.length === 0) return []

  // Snapshot of winners already chosen on this launch (each wallet wins once).
  const priorWinners = await getPriorGen2MilestoneWinnerWallets(launch.id)
  const minterRows = await aggregateMinterWallets(launch.id)
  const changed: Gen2MintMilestone[] = []

  // Lowest target first so the natural unlock order is preserved.
  crossedPending.sort(
    (a, b) => gen2MilestoneTargetMints(a, totalSupply) - gen2MilestoneTargetMints(b, totalSupply)
  )

  for (const milestone of crossedPending) {
    // Not funded when its threshold was crossed -> void (no retroactive prizes).
    if (!milestone.deposit_verified_at) {
      const voided = await transitionGen2MilestoneStatus(milestone.id, 'pending', {
        status: 'void',
      })
      if (voided) changed.push(voided)
      continue
    }

    const useTopBuyer = milestone.winner_mode === 'top_buyer'
    const winner = useTopBuyer
      ? pickTopBuyerWallet(minterRows, priorWinners)
      : pickRandomWalletWeighted(minterRows, priorWinners)

    // No eligible minter left (everyone already won, or no minters yet): unlock
    // and leave for a later sweep rather than burning the prize.
    if (!winner) {
      const unlocked = await transitionGen2MilestoneStatus(milestone.id, 'pending', {
        status: 'unlocked',
        unlocked_at: new Date().toISOString(),
        unlocked_at_minted_count: mintedCount,
      })
      if (unlocked) changed.push(unlocked)
      continue
    }

    const now = new Date().toISOString()
    const awarded = await transitionGen2MilestoneStatus(milestone.id, 'pending', {
      status: 'awarded',
      unlocked_at: now,
      unlocked_at_minted_count: mintedCount,
      winner_wallet: winner,
      winner_selected_at: now,
      winner_selection_mode: useTopBuyer ? 'auto_top_buyer' : 'auto_random',
    })
    if (awarded) {
      priorWinners.add(winner)
      changed.push(awarded)
    }
  }

  return changed
}

/**
 * Sweep any `unlocked` (funded, crossed, but unwinnable-at-the-time) milestones
 * and try to award them now. Safe to call from a cron or a later mint.
 */
export async function settleUnlockedGen2MintMilestones(
  launch: Pick<OwlCenterLaunchPublic, 'id' | 'minted_count'>
): Promise<Gen2MintMilestone[]> {
  const milestones = await getGen2MilestonesByLaunchId(launch.id)
  const unlocked = milestones.filter((m) => m.status === 'unlocked' && m.deposit_verified_at)
  if (unlocked.length === 0) return []

  const priorWinners = await getPriorGen2MilestoneWinnerWallets(launch.id)
  const minterRows = await aggregateMinterWallets(launch.id)
  const changed: Gen2MintMilestone[] = []

  for (const milestone of unlocked) {
    const useTopBuyer = milestone.winner_mode === 'top_buyer'
    const winner = useTopBuyer
      ? pickTopBuyerWallet(minterRows, priorWinners)
      : pickRandomWalletWeighted(minterRows, priorWinners)
    if (!winner) continue

    const now = new Date().toISOString()
    const awarded = await transitionGen2MilestoneStatus(milestone.id, 'unlocked', {
      status: 'awarded',
      winner_wallet: winner,
      winner_selected_at: now,
      winner_selection_mode: useTopBuyer ? 'auto_top_buyer' : 'auto_random',
    })
    if (awarded) {
      priorWinners.add(winner)
      changed.push(awarded)
    }
  }

  return changed
}

/** Mark a milestone void (admin cancel before unlock). Deposit becomes returnable. */
export async function voidGen2Milestone(milestoneId: string): Promise<void> {
  await updateGen2Milestone(milestoneId, { status: 'void' })
}
