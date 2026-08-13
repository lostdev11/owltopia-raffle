import { supabase } from '@/lib/supabase'
import { getSupabaseForServerRead } from '@/lib/supabase-admin'
import type { RaffleRevenue } from '@/lib/raffle-profit'

export type RaffleEntryListStats = {
  raffleId: string
  ticketsSold: number
  totalEntries: number
  confirmedEntries: number
  uniqueWallets: number
  revenue: RaffleRevenue
  viewerConfirmedTickets: number
}

type RpcRow = {
  raffle_id: string
  tickets_sold: number | string | null
  total_entries: number | string | null
  confirmed_entries: number | string | null
  unique_wallets: number | string | null
  revenue_sol: number | string | null
  revenue_usdc: number | string | null
  revenue_owl: number | string | null
  revenue_bamboo: number | string | null
  revenue_goats: number | string | null
  viewer_confirmed_tickets: number | string | null
}

type NarrowEntryRow = {
  raffle_id: string
  wallet_address: string | null
  ticket_quantity: number | string | null
  status: string | null
  amount_paid: number | string | null
  currency: string | null
  refunded_at: string | null
}

function num(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function emptyStats(raffleId: string): RaffleEntryListStats {
  return {
    raffleId,
    ticketsSold: 0,
    totalEntries: 0,
    confirmedEntries: 0,
    uniqueWallets: 0,
    revenue: { sol: 0, usdc: 0, owl: 0, bamboo: 0, goats: 0 },
    viewerConfirmedTickets: 0,
  }
}

/**
 * Fallback if migration 210 RPC is not applied yet: one narrow multi-raffle page scan + JS aggregate.
 * Still far cheaper than N× select('*') list polls.
 */
async function summarizeEntriesFallback(
  ids: string[],
  viewerWallet: string | null
): Promise<Map<string, RaffleEntryListStats>> {
  const out = new Map<string, RaffleEntryListStats>()
  const walletsByRaffle = new Map<string, Set<string>>()
  for (const id of ids) {
    out.set(id, emptyStats(id))
    walletsByRaffle.set(id, new Set())
  }

  const db = getSupabaseForServerRead(supabase)
  const pageSize = 1000
  let offset = 0
  for (;;) {
    const { data, error } = await db
      .from('entries')
      .select('raffle_id, wallet_address, ticket_quantity, status, amount_paid, currency, refunded_at')
      .in('raffle_id', ids)
      .range(offset, offset + pageSize - 1)
    if (error) {
      console.error('[entry-summaries] fallback select:', error.message)
      break
    }
    const rows = (data ?? []) as NarrowEntryRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      const id = String(row.raffle_id ?? '').trim()
      const stats = out.get(id)
      if (!stats) continue
      stats.totalEntries += 1
      if (row.status === 'confirmed') {
        stats.confirmedEntries += 1
        const wallet = (row.wallet_address ?? '').trim()
        if (wallet) walletsByRaffle.get(id)?.add(wallet)
        if (!row.refunded_at) {
          stats.ticketsSold += num(row.ticket_quantity)
          if (viewerWallet && wallet === viewerWallet) {
            stats.viewerConfirmedTickets += num(row.ticket_quantity)
          }
        }
        const amount = num(row.amount_paid)
        const c = String(row.currency ?? '').toUpperCase()
        if (c === 'SOL') stats.revenue.sol += amount
        else if (c === 'USDC') stats.revenue.usdc += amount
        else if (c === 'OWL') stats.revenue.owl += amount
        else if (c === 'BAMBOO') stats.revenue.bamboo += amount
        else if (c === 'GOATS') stats.revenue.goats += amount
      }
    }

    if (rows.length < pageSize) break
    offset += pageSize
  }

  for (const [id, stats] of out) {
    stats.uniqueWallets = walletsByRaffle.get(id)?.size ?? 0
  }
  return out
}

/**
 * One SQL aggregate per raffle id — for list/carousel polls (avoids N× full entry dumps).
 */
export async function getEntrySummariesByRaffleIds(
  raffleIds: string[],
  viewerWallet?: string | null
): Promise<Map<string, RaffleEntryListStats>> {
  const ids = [...new Set(raffleIds.map((id) => id.trim()).filter(Boolean))]
  const out = new Map<string, RaffleEntryListStats>()
  if (ids.length === 0) return out

  const wallet = viewerWallet?.trim() || null
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db.rpc('summarize_entries_for_raffle_ids', {
    p_ids: ids,
    p_viewer_wallet: wallet,
  })

  if (error) {
    console.warn(
      '[entry-summaries] RPC unavailable, using narrow-select fallback (apply migration 210):',
      error.message
    )
    return summarizeEntriesFallback(ids, wallet)
  }

  for (const row of (data ?? []) as RpcRow[]) {
    const raffleId = String(row.raffle_id ?? '').trim()
    if (!raffleId) continue
    out.set(raffleId, {
      raffleId,
      ticketsSold: num(row.tickets_sold),
      totalEntries: num(row.total_entries),
      confirmedEntries: num(row.confirmed_entries),
      uniqueWallets: num(row.unique_wallets),
      revenue: {
        sol: num(row.revenue_sol),
        usdc: num(row.revenue_usdc),
        owl: num(row.revenue_owl),
        bamboo: num(row.revenue_bamboo),
        goats: num(row.revenue_goats),
      },
      viewerConfirmedTickets: num(row.viewer_confirmed_tickets),
    })
  }

  // Raffles with zero entries are absent from GROUP BY — fill zeros so clients can clear stale stats.
  for (const id of ids) {
    if (!out.has(id)) {
      out.set(id, emptyStats(id))
    }
  }

  return out
}
