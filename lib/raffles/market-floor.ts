/** Pure helpers for marketplace floor display (safe for client + server). */

export const MARKET_FLOOR_STALE_MS = 15 * 60 * 1000
export const MARKET_FLOOR_REFRESH_BATCH = 25

export function isMarketFloorStale(
  fetchedAt: string | null | undefined,
  nowMs: number = Date.now(),
  staleMs: number = MARKET_FLOOR_STALE_MS
): boolean {
  if (fetchedAt == null || !String(fetchedAt).trim()) return true
  const t = Date.parse(fetchedAt)
  if (!Number.isFinite(t)) return true
  return nowMs - t >= staleMs
}
