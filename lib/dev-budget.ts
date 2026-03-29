/**
 * Local development: ease background fetch + DAS cache so Helius / RPC credits are not burned quickly.
 * Opt out with NEXT_PUBLIC_DEV_FULL_POLLING=1 when you need production-style intervals.
 */
export function devSaveApiCredits(): boolean {
  if (process.env.NODE_ENV !== 'development') return false
  const v = process.env.NEXT_PUBLIC_DEV_FULL_POLLING?.trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes') return false
  return true
}

/** TTL for ownsOwltopia() in-memory cache (server). */
export const OWLTOPIA_DAS_CACHE_TTL_MS = devSaveApiCredits() ? 600_000 : 45_000

/** Global live activity: GET /api/raffles */
export const LIVE_ACTIVITY_REFETCH_MS = devSaveApiCredits() ? 600_000 : 90_000

/** Raffles "All" tab: full server re-render (includes holder enrichment → Helius). */
export const RAFFLES_PAGE_SERVER_REFRESH_MS = devSaveApiCredits() ? 600_000 : 60_000

/** Raffles list: entry totals for active raffles */
export const RAFFLES_LIST_ENTRIES_POLL_MS = devSaveApiCredits() ? 30_000 : 3_000

/** Raffle detail: entries when Realtime is off */
export const RAFFLE_DETAIL_ENTRIES_POLL_MS = devSaveApiCredits() ? 20_000 : 3_000

/** While Realtime is connected, still refetch occasionally (missed postgres_changes, sleeping tab, flaky network). */
export const RAFFLE_DETAIL_ENTRIES_REALTIME_SAFETY_POLL_MS = devSaveApiCredits()
  ? 120_000
  : 20_000

/** Enter Owltopia page: GET /api/rev-share (runs ownsOwltopia per creator) */
export const ENTER_OWLTOPIA_REVSHARE_POLL_MS = devSaveApiCredits() ? 180_000 : 30_000
