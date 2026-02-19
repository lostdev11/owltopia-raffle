/**
 * In-memory rate limiter (v1). Use Redis/Upstash for production at scale.
 * Keys by identifier (e.g. IP or IP+wallet); allows N requests per windowMs.
 * In serverless environments with multiple instances, each instance has its own
 * store — use a shared store (e.g. Upstash Redis) for strict cross-instance limits.
 */

type Entry = { count: number; resetAt: number }

const store = new Map<string, Entry>()
const WINDOW_MS = 60 * 1000 // 1 minute
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

function cleanup(): void {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key)
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null
function scheduleCleanup(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS)
  if (cleanupTimer.unref) cleanupTimer.unref()
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

/**
 * @param key - e.g. IP address or `ip:wallet`
 * @param limit - max requests per window
 * @param windowMs - window in ms (default 60_000)
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number = WINDOW_MS
): RateLimitResult {
  scheduleCleanup()
  const now = Date.now()
  let entry = store.get(key)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs }
    store.set(key, entry)
  }
  entry.count += 1
  const allowed = entry.count <= limit
  const remaining = Math.max(0, limit - entry.count)
  return {
    allowed,
    remaining,
    resetAt: entry.resetAt,
  }
}

/** Get client IP from NextRequest (Vercel/Node) */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real
  return 'unknown'
}
