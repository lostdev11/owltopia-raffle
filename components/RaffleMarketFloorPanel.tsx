'use client'

import { useEffect, useState } from 'react'
import { formatMarketFloorSol } from '@/lib/nft-floor-price-fetch'
import { isMarketFloorStale } from '@/lib/raffles/market-floor'
import { cn } from '@/lib/utils'

type MarketFloorSnapshot = {
  market_floor_sol: number | null
  market_floor_fetched_at: string | null
  market_floor_source: 'magic_eden' | 'tensor' | 'none' | null
  market_floor_collection_symbol: string | null
}

/**
 * Shows live marketplace floor next to listed floor, and lazily refreshes when stale.
 */
export function RaffleMarketFloorPanel({
  raffleId,
  prizeType,
  status,
  initial,
  labelClassName,
  valueClassName,
  className,
}: {
  raffleId: string
  prizeType: string | null | undefined
  status: string | null | undefined
  initial: MarketFloorSnapshot
  labelClassName?: string
  valueClassName?: string
  className?: string
}) {
  const [snapshot, setSnapshot] = useState<MarketFloorSnapshot>(initial)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    setSnapshot(initial)
  }, [
    initial.market_floor_sol,
    initial.market_floor_fetched_at,
    initial.market_floor_source,
    initial.market_floor_collection_symbol,
  ])

  useEffect(() => {
    if ((prizeType || '').toLowerCase() !== 'nft') return
    const st = (status || '').toLowerCase()
    if (st !== 'live' && st !== 'ready_to_draw' && st !== 'draft') return
    if (!isMarketFloorStale(snapshot.market_floor_fetched_at)) return

    let cancelled = false
    const ac = new AbortController()
    setRefreshing(true)
    void (async () => {
      try {
        const res = await fetch(`/api/raffles/${encodeURIComponent(raffleId)}/refresh-market-floor`, {
          method: 'POST',
          signal: ac.signal,
        })
        if (!res.ok || cancelled) return
        const json = (await res.json()) as {
          market_floor_sol?: number | null
          market_floor_fetched_at?: string | null
          market_floor_source?: MarketFloorSnapshot['market_floor_source']
          market_floor_collection_symbol?: string | null
        }
        if (cancelled) return
        setSnapshot({
          market_floor_sol: json.market_floor_sol ?? null,
          market_floor_fetched_at: json.market_floor_fetched_at ?? null,
          market_floor_source: json.market_floor_source ?? null,
          market_floor_collection_symbol: json.market_floor_collection_symbol ?? null,
        })
      } catch {
        /* network / abort */
      } finally {
        if (!cancelled) setRefreshing(false)
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
    }
  }, [raffleId, prizeType, status, snapshot.market_floor_fetched_at])

  if ((prizeType || '').toLowerCase() !== 'nft') return null

  const floorSol = snapshot.market_floor_sol
  const sourceLabel =
    snapshot.market_floor_source === 'magic_eden'
      ? 'Magic Eden'
      : snapshot.market_floor_source === 'tensor'
        ? 'Tensor'
        : null

  return (
    <div className={cn(className)}>
      <p className={cn(labelClassName, 'text-muted-foreground')}>Live market floor</p>
      {floorSol != null && floorSol > 0 ? (
        <p className={cn(valueClassName, 'font-semibold')}>
          {formatMarketFloorSol(floorSol)} SOL
          {sourceLabel ? (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">({sourceLabel})</span>
          ) : null}
        </p>
      ) : (
        <p className={cn(valueClassName, 'font-semibold text-muted-foreground')}>
          {refreshing ? 'Updating…' : 'Unavailable'}
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        Display only — ticket price and draw goal use the listed floor above, not this market value.
      </p>
    </div>
  )
}
