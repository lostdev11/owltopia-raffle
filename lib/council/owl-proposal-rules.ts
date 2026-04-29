/** Minimum human-readable OWL needed to create a Council proposal (UI + live API check). */
export const MIN_OWL_TO_CREATE_PROPOSAL = 10

/** Maximum span from start_time to end_time (voting window). */
export const MAX_COUNCIL_PROPOSAL_DURATION_DAYS = 7
export const MAX_COUNCIL_PROPOSAL_DURATION_MS =
  MAX_COUNCIL_PROPOSAL_DURATION_DAYS * 24 * 60 * 60 * 1000

/** Returns null if start/end are valid; otherwise an error message for API/UI. */
export function getCouncilProposalWindowError(startTime: string, endTime: string): string | null {
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 'Invalid start or end time.'
  }
  if (end <= start) {
    return 'end_time must be after start_time.'
  }
  if (end - start > MAX_COUNCIL_PROPOSAL_DURATION_MS) {
    return `End time must be within ${MAX_COUNCIL_PROPOSAL_DURATION_DAYS} days after the start time.`
  }
  return null
}

/** Latest instant allowed for `end_time` given `start_time` (same rule as {@link getCouncilProposalWindowError}). */
export function getMaxCouncilProposalEndDate(startTime: string): Date | null {
  const start = new Date(startTime).getTime()
  if (Number.isNaN(start)) return null
  return new Date(start + MAX_COUNCIL_PROPOSAL_DURATION_MS)
}
