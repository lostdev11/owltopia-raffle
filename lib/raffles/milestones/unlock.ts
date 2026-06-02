import type { Entry, Raffle, RaffleMilestone } from '@/lib/types'
import {
  getMilestonesByRaffleId,
  updateRaffleMilestone,
} from '@/lib/db/raffle-milestones'
import { isMilestoneUnlockedBySales, ticketsSoldFromEntries } from '@/lib/raffles/milestones/draw'

/**
 * Mark milestones as unlocked when confirmed ticket sales cross their trigger.
 */
export async function syncMilestoneUnlocksForRaffle(
  raffle: Pick<Raffle, 'id' | 'max_tickets' | 'min_tickets' | 'prize_type' | 'floor_price' | 'ticket_price'>,
  entries: Entry[]
): Promise<RaffleMilestone[]> {
  const milestones = await getMilestonesByRaffleId(raffle.id)
  if (milestones.length === 0) return milestones

  const sold = ticketsSoldFromEntries(entries)
  const now = new Date().toISOString()

  for (const m of milestones) {
    if (m.status !== 'pending') continue
    if (!isMilestoneUnlockedBySales(raffle, m, sold)) continue
    await updateRaffleMilestone(m.id, {
      status: 'unlocked',
      unlocked_at: now,
    })
  }

  return getMilestonesByRaffleId(raffle.id)
}
