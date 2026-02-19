/**
 * In-flight verification lock: only one verify may run per entryId at a time.
 * Prevents race where multiple verify(entryId, tx) requests run in parallel,
 * and ensures we do not "reset" (invalidate) an entry in create() while
 * verify() is still processing that entry.
 */

const inVerification = new Set<string>()

/**
 * Try to acquire the lock for this entryId. Returns true if acquired,
 * false if this entry is already being verified (caller should reject with 429).
 */
export function tryAcquireVerificationLock(entryId: string): boolean {
  if (inVerification.has(entryId)) return false
  inVerification.add(entryId)
  return true
}

/**
 * Release the lock after verification completes (success or failure).
 * Must be called in a finally block so it always runs.
 */
export function releaseVerificationLock(entryId: string): void {
  inVerification.delete(entryId)
}

/**
 * Returns true if any of the given entry IDs are currently being verified.
 * Used by create() to avoid invalidating an entry that is mid-verification.
 */
export function hasAnyInVerification(entryIds: string[]): boolean {
  return entryIds.some((id) => inVerification.has(id))
}
