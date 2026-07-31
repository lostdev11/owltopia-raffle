import type { RaffleEntryListStats } from '@/lib/db/entry-summaries'

type ApiSummary = {
  raffleId: string
  ticketsSold: number
  totalEntries: number
  confirmedEntries: number
  uniqueWallets: number
  revenue: RaffleEntryListStats['revenue']
  viewerConfirmedTickets: number
}

/** One request for many raffles (list/carousel poll). */
export async function fetchEntrySummariesByRaffleIdsClient(
  raffleIds: readonly string[],
  viewerWallet?: string | null,
  signal?: AbortSignal
): Promise<Map<string, RaffleEntryListStats>> {
  const map = new Map<string, RaffleEntryListStats>()
  if (typeof window === 'undefined' || raffleIds.length === 0) return map

  const unique = [...new Set(raffleIds.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 0) return map

  const apiBase = window.location.origin
  const params = new URLSearchParams({
    ids: unique.join(','),
    _t: String(Date.now()),
  })
  const wallet = viewerWallet?.trim()
  if (wallet) params.set('wallet', wallet)

  try {
    const res = await fetch(`${apiBase}/api/entries/summaries?${params}`, {
      cache: 'no-store',
      signal,
    })
    if (!res.ok) return map
    const data = (await res.json()) as { summaries?: ApiSummary[] }
    for (const s of data.summaries ?? []) {
      if (!s?.raffleId) continue
      map.set(s.raffleId, {
        raffleId: s.raffleId,
        ticketsSold: Number(s.ticketsSold) || 0,
        totalEntries: Number(s.totalEntries) || 0,
        confirmedEntries: Number(s.confirmedEntries) || 0,
        uniqueWallets: Number(s.uniqueWallets) || 0,
        revenue: {
          sol: Number(s.revenue?.sol) || 0,
          usdc: Number(s.revenue?.usdc) || 0,
          owl: Number(s.revenue?.owl) || 0,
          bamboo: Number(s.revenue?.bamboo) || 0,
        },
        viewerConfirmedTickets: Number(s.viewerConfirmedTickets) || 0,
      })
    }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') {
      console.error('[fetchEntrySummariesByRaffleIdsClient]', err)
    }
  }
  return map
}
