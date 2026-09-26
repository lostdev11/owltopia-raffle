/** Stop starting new Claim-all batches when less than this remains before the route deadline. */
export const CLAIM_ALL_DEADLINE_BUFFER_MS = 15_000

/** Vercel `maxDuration` for claim-all routes (seconds). */
export const CLAIM_ALL_ROUTE_MAX_DURATION_SEC = 300

/** Hard deadline for batch execution (ms since epoch). */
export function claimAllExecutionDeadlineMs(startedAtMs: number = Date.now()): number {
  return startedAtMs + CLAIM_ALL_ROUTE_MAX_DURATION_SEC * 1000
}

export function shouldStopClaimAllBatchesForDeadline(
  deadlineMs: number | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!deadlineMs || !Number.isFinite(deadlineMs)) return false
  return deadlineMs - nowMs < CLAIM_ALL_DEADLINE_BUFFER_MS
}
