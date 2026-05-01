import type { Entry } from '@/lib/types'

/** Parallel GET /api/entries for many raffles (browser only; used after cart purchase). */
export async function fetchEntriesByRaffleIdsClient(
  raffleIds: readonly string[]
): Promise<Map<string, Entry[]>> {
  const map = new Map<string, Entry[]>()
  if (typeof window === 'undefined' || raffleIds.length === 0) return map
  const apiBase = window.location.origin
  const unique = [...new Set(raffleIds.map((id) => id.trim()).filter(Boolean))]
  await Promise.all(
    unique.map(async (id) => {
      try {
        const url = `${apiBase}/api/entries?raffleId=${encodeURIComponent(id)}&_t=${Date.now()}`
        const res = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
        if (!res.ok) return
        const data = await res.json()
        map.set(id, Array.isArray(data) ? (data as Entry[]) : [])
      } catch {
        /* ignore */
      }
    })
  )
  return map
}
