/**
 * Persist / refresh marketplace floor snapshots on NFT raffles.
 * Updates market_floor_* only — never floor_price, ticket_price, or min_tickets.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { fetchNftMarketFloorByMint } from '@/lib/nft-floor-price-fetch'
import {
  MARKET_FLOOR_REFRESH_BATCH,
  MARKET_FLOOR_STALE_MS,
  isMarketFloorStale,
} from '@/lib/raffles/market-floor'

export { MARKET_FLOOR_REFRESH_BATCH, MARKET_FLOOR_STALE_MS, isMarketFloorStale } from '@/lib/raffles/market-floor'

export type RaffleMarketFloorFields = {
  market_floor_sol: number | null
  market_floor_fetched_at: string | null
  market_floor_source: 'tensor' | 'orbis' | 'magic_eden' | 'none' | null
  market_floor_collection_symbol: string | null
}

export async function updateRaffleMarketFloorFields(
  raffleId: string,
  fields: RaffleMarketFloorFields
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = raffleId.trim()
  if (!id) return { ok: false, error: 'raffle id required' }

  const { error } = await getSupabaseAdmin()
    .from('raffles')
    .update({
      market_floor_sol: fields.market_floor_sol,
      market_floor_fetched_at: fields.market_floor_fetched_at,
      market_floor_source: fields.market_floor_source,
      market_floor_collection_symbol: fields.market_floor_collection_symbol,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    // Column missing (migration not applied) — soft-fail so callers can continue.
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('market_floor') || msg.includes('42703') || msg.includes('column')) {
      return { ok: false, error: 'market_floor columns not applied' }
    }
    return { ok: false, error: error.message || 'update failed' }
  }
  return { ok: true }
}

export type RefreshMarketFloorResult = {
  raffleId: string
  refreshed: boolean
  skipped?: string
  floorSol?: number | null
  source?: string | null
  error?: string
}

/**
 * Fetch marketplace floor for one raffle mint and persist display fields only.
 */
export async function refreshRaffleMarketFloor(input: {
  raffleId: string
  nftMintAddress: string
  collectionSymbol?: string | null
  force?: boolean
  fetchedAt?: string | null
}): Promise<RefreshMarketFloorResult> {
  const raffleId = input.raffleId.trim()
  const mint = input.nftMintAddress.trim()
  if (!raffleId || !mint) {
    return { raffleId, refreshed: false, skipped: 'missing raffle or mint' }
  }

  if (!input.force && !isMarketFloorStale(input.fetchedAt ?? null)) {
    return { raffleId, refreshed: false, skipped: 'fresh' }
  }

  const lookup = await fetchNftMarketFloorByMint(mint, {
    collectionSymbol: input.collectionSymbol,
    bypassCache: input.force === true,
  })

  const nowIso = new Date().toISOString()
  const fields: RaffleMarketFloorFields = lookup.ok
    ? {
        market_floor_sol: lookup.floorSol,
        market_floor_fetched_at: nowIso,
        market_floor_source: lookup.source,
        market_floor_collection_symbol: lookup.collectionSymbol,
      }
    : {
        market_floor_sol: null,
        market_floor_fetched_at: nowIso,
        market_floor_source: 'none',
        market_floor_collection_symbol: lookup.collectionSymbol,
      }

  const saved = await updateRaffleMarketFloorFields(raffleId, fields)
  if (!saved.ok) {
    return { raffleId, refreshed: false, error: saved.error, floorSol: fields.market_floor_sol, source: fields.market_floor_source }
  }

  return {
    raffleId,
    refreshed: true,
    floorSol: fields.market_floor_sol,
    source: fields.market_floor_source,
    ...(lookup.ok ? {} : { skipped: lookup.reason }),
  }
}

type StaleRaffleRow = {
  id: string
  nft_mint_address: string | null
  market_floor_fetched_at: string | null
  market_floor_collection_symbol: string | null
}

/**
 * Refresh a batch of live/ready_to_draw NFT raffles with stale market floors.
 */
export async function refreshStaleLiveRaffleMarketFloors(options?: {
  limit?: number
  staleMs?: number
}): Promise<{ processed: number; results: RefreshMarketFloorResult[] }> {
  const limit = Math.min(Math.max(options?.limit ?? MARKET_FLOOR_REFRESH_BATCH, 1), 100)
  const staleMs = options?.staleMs ?? MARKET_FLOOR_STALE_MS
  const staleBefore = new Date(Date.now() - staleMs).toISOString()

  const { data, error } = await getSupabaseAdmin()
    .from('raffles')
    .select('id,nft_mint_address,market_floor_fetched_at,market_floor_collection_symbol')
    .eq('prize_type', 'nft')
    .in('status', ['live', 'ready_to_draw'])
    .not('nft_mint_address', 'is', null)
    .or(`market_floor_fetched_at.is.null,market_floor_fetched_at.lt.${staleBefore}`)
    .order('market_floor_fetched_at', { ascending: true, nullsFirst: true })
    .limit(limit)

  if (error) {
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('market_floor') || msg.includes('42703') || msg.includes('column')) {
      return { processed: 0, results: [] }
    }
    throw new Error(error.message || 'Failed to list raffles for market floor refresh')
  }

  const rows = (data ?? []) as StaleRaffleRow[]
  const results: RefreshMarketFloorResult[] = []

  for (const row of rows) {
    const mint = (row.nft_mint_address ?? '').trim()
    if (!mint) {
      results.push({ raffleId: row.id, refreshed: false, skipped: 'no mint' })
      continue
    }
    // Small delay between marketplace calls to stay under public rate limits.
    if (results.length > 0) {
      await new Promise((r) => setTimeout(r, 150))
    }
    const result = await refreshRaffleMarketFloor({
      raffleId: row.id,
      nftMintAddress: mint,
      collectionSymbol: row.market_floor_collection_symbol,
      force: true,
      fetchedAt: row.market_floor_fetched_at,
    })
    results.push(result)
  }

  return { processed: results.length, results }
}
