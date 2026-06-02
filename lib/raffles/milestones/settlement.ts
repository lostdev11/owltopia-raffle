import type { Entry, Raffle, RaffleMilestone } from '@/lib/types'
import {
  getMilestonesByRaffleId,
  updateRaffleMilestone,
} from '@/lib/db/raffle-milestones'
import { resolveMilestoneWinnerWallet } from '@/lib/raffles/milestones/draw'
import type { RaffleMilestoneWinnerSelectionMode } from '@/lib/types'

function selectionModeForMilestone(
  milestone: Pick<RaffleMilestone, 'winner_mode'>,
  creatorTriggered: boolean
): RaffleMilestoneWinnerSelectionMode {
  if (creatorTriggered) return 'creator_triggered_random'
  if (milestone.winner_mode === 'top_buyer') return 'auto_top_buyer'
  return 'auto_random'
}

/**
 * Award one unlocked milestone (caller ensures raffle succeeded and main winner known).
 */
export async function awardMilestoneWinner(params: {
  raffle: Raffle
  milestone: RaffleMilestone
  entries: Entry[]
  mainWinnerWallet: string
  priorMilestoneWinners: Set<string>
  creatorTriggered?: boolean
}): Promise<RaffleMilestone | null> {
  const { milestone, entries, mainWinnerWallet, priorMilestoneWinners } = params
  if (milestone.status !== 'unlocked') return milestone
  if (milestone.winner_wallet) return milestone

  const exclude = new Set<string>([...priorMilestoneWinners])
  const mainW = mainWinnerWallet.trim()
  if (mainW && mainW !== '__none__') {
    exclude.add(mainW)
  }
  const creatorTriggered = params.creatorTriggered === true
  const selectionMode = selectionModeForMilestone(milestone, creatorTriggered)

  const winner = resolveMilestoneWinnerWallet({
    milestone,
    entries,
    excludeWallets: exclude,
    selectionMode,
  })
  if (!winner) {
    console.warn(`[milestones] No eligible winner for milestone ${milestone.id}`)
    return milestone
  }

  const now = new Date().toISOString()
  await updateRaffleMilestone(milestone.id, {
    status: 'awarded',
    winner_wallet: winner,
    winner_selected_at: now,
    winner_selection_mode: selectionMode,
  })
  const updated = (await getMilestonesByRaffleId(milestone.raffle_id)).find((m) => m.id === milestone.id)
  return updated ?? null
}

/**
 * After main winner is drawn: auto-award milestones that are unlocked and not creator-initiated-waiting.
 */
export async function settleUnawardedMilestones(params: {
  raffle: Raffle
  entries: Entry[]
  mainWinnerWallet: string
}): Promise<void> {
  const milestones = await getMilestonesByRaffleId(params.raffle.id)
  const priorWinners = new Set<string>()
  const now = new Date()
  const raffleEnded = new Date(params.raffle.end_time) <= now

  for (const m of milestones.sort((a, b) => a.sort_order - b.sort_order)) {
    if (m.status !== 'unlocked') continue
    if (m.winner_wallet) {
      priorWinners.add(m.winner_wallet.trim())
      continue
    }
    if (m.winner_mode === 'creator_initiated_pull' && !raffleEnded) continue

    const awarded = await awardMilestoneWinner({
      raffle: params.raffle,
      milestone: m,
      entries: params.entries,
      mainWinnerWallet: params.mainWinnerWallet,
      priorMilestoneWinners: priorWinners,
      creatorTriggered: false,
    })
    if (awarded?.winner_wallet) priorWinners.add(awarded.winner_wallet.trim())
  }
}

export async function voidMilestonesOnFailedRaffle(raffleId: string): Promise<void> {
  const milestones = await getMilestonesByRaffleId(raffleId)
  for (const m of milestones) {
    if (m.status === 'returned' || m.status === 'void' || m.status === 'claimed') continue
    if (m.status === 'awarded' && m.claimed_at) continue
    await updateRaffleMilestone(m.id, { status: 'void' })
  }
}
