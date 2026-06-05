const lastReplyByUser = new Map<string, number>()

export function isOnCooldown(userId: string, cooldownSec: number, now = Date.now()): boolean {
  const last = lastReplyByUser.get(userId)
  if (!last) return false
  return now - last < cooldownSec * 1000
}

export function markReplied(userId: string, now = Date.now()): void {
  lastReplyByUser.set(userId, now)
  if (lastReplyByUser.size > 10_000) {
    const cutoff = now - 3600_000
    for (const [id, ts] of lastReplyByUser) {
      if (ts < cutoff) lastReplyByUser.delete(id)
    }
  }
}
