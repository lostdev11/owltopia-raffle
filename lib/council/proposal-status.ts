import type { OwlProposalRow } from '@/lib/db/owl-council'

/** Timeline-based UI bucket for published proposals */
export type CouncilProposalTimeline = 'upcoming' | 'active' | 'past'

export function getProposalTimeline(row: OwlProposalRow, nowMs = Date.now()): CouncilProposalTimeline | null {
  if (row.status === 'draft') return null
  const startMs = new Date(row.start_time).getTime()
  const endMs = new Date(row.end_time).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null

  if (row.status === 'active') {
    if (startMs > nowMs) return 'upcoming'
    if (endMs >= nowMs && startMs <= nowMs) return 'active'
    return 'past'
  }
  return 'past'
}

/** True when voting is allowed in MVP (single window, DB status active). */
export function isCouncilVotingOpen(row: OwlProposalRow, nowMs = Date.now()): boolean {
  if (row.status !== 'active') return false
  const startMs = new Date(row.start_time).getTime()
  const endMs = new Date(row.end_time).getTime()
  return !Number.isNaN(startMs) && !Number.isNaN(endMs) && nowMs >= startMs && nowMs <= endMs
}
