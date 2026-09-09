import type { RaffleMilestone } from '@/lib/types'

const RETURNABLE_MILESTONE_STATUSES = new Set<RaffleMilestone['status']>([
  'void',
  'pending',
  'unlocked',
])

/** Raffle ended in a state where prefunded milestone escrows may go back to the creator. */
export function isTerminalRaffleForMilestoneReturn(status: string | null | undefined): boolean {
  const st = (status ?? '').trim().toLowerCase()
  return st === 'failed_refund_available' || st === 'cancelled'
}

/**
 * Whether a crypto milestone deposit can be returned to the raffle creator.
 * Mirrors {@link returnMilestoneDepositToCreator} preconditions for UI and admin tooling.
 */
export function isMilestoneDepositReturnable(params: {
  milestone: Pick<
    RaffleMilestone,
    'status' | 'deposit_verified_at' | 'returned_at' | 'return_tx' | 'prize_type'
  >
  raffleStatus: string | null | undefined
}): boolean {
  if (!isTerminalRaffleForMilestoneReturn(params.raffleStatus)) return false

  const m = params.milestone
  if (m.prize_type !== 'crypto') return false
  if (!m.deposit_verified_at) return false
  if (m.returned_at && m.return_tx) return false
  if (m.status === 'returned' || m.status === 'claimed') return false
  if (m.status === 'awarded') return false

  return RETURNABLE_MILESTONE_STATUSES.has(m.status)
}
