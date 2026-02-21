/**
 * Client-side cache for admin check to avoid repeated API calls and reduce perceived delay.
 * Only used in browser; safe to import from client components.
 */

const CACHE_TTL_MS = 60_000 // 1 minute

export type AdminRole = 'full' | 'raffle_creator'

type CacheEntry = { wallet: string; isAdmin: boolean; role: AdminRole | null; ts: number }

let cached: CacheEntry | null = null

function isExpired(e: CacheEntry): boolean {
  return Date.now() - e.ts > CACHE_TTL_MS
}

/** Returns cached isAdmin for this wallet, or null if missing/expired. */
export function getCachedAdmin(wallet: string): boolean | null {
  if (typeof window === 'undefined' || !wallet) return null
  if (!cached || cached.wallet !== wallet || isExpired(cached)) return null
  return cached.isAdmin
}

/** Returns cached admin role, or null if missing/expired/not admin. */
export function getCachedAdminRole(wallet: string): AdminRole | null {
  if (typeof window === 'undefined' || !wallet) return null
  if (!cached || cached.wallet !== wallet || isExpired(cached)) return null
  return cached.role
}

/** Stores admin check result for this wallet. */
export function setCachedAdmin(wallet: string, isAdmin: boolean, role?: AdminRole | null): void {
  if (typeof window === 'undefined' || !wallet) return
  cached = {
    wallet,
    isAdmin,
    role: role ?? (isAdmin ? 'full' : null),
    ts: Date.now(),
  }
}
