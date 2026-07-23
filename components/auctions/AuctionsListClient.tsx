'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Loader2, Gavel, Plus } from 'lucide-react'
import type { NftAuctionPublic } from '@/lib/auctions/types'

function formatEnds(endsAt: string): string {
  const t = new Date(endsAt).getTime()
  if (!Number.isFinite(t)) return '—'
  const ms = t - Date.now()
  if (ms <= 0) return 'Ended'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function AuctionsListClient() {
  const [auctions, setAuctions] = useState<NftAuctionPublic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auctions?status=live,draft,successful_pending_claims,failed_reserve', {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Failed to load auctions')
        setAuctions([])
        return
      }
      setAuctions((json.auctions || []) as NftAuctionPublic[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Gavel className="h-7 w-7 text-emerald-500" />
            Partner auctions
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            English auctions with optional reserve. Partners only in beta — NFT, SOL, or USDC prizes;
            bids in SOL/USDC. Same fee tiers as raffles (2% / 3% / 6%).
          </p>
        </div>
        <Button asChild className="min-h-[44px]">
          <Link href="/auctions/new">
            <Plus className="h-4 w-4 mr-2" />
            Create auction
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : auctions.length === 0 ? (
        <p className="text-muted-foreground text-sm py-8">
          No auctions yet. Create one to list an NFT or crypto prize with a start price and optional
          reserve.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 border border-border/60 rounded-xl overflow-hidden">
          {auctions.map((a) => (
            <li key={a.id}>
              <Link
                href={`/auctions/${encodeURIComponent(a.slug)}`}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-4 hover:bg-white/5 min-h-[44px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{a.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {a.prize_type.toUpperCase()} · {a.status} · fee {a.fee_bps_applied / 100}%
                    {a.has_reserve ? (a.reserve_met ? ' · reserve met' : ' · reserve not met') : ''}
                  </div>
                </div>
                <div className="text-sm sm:text-right shrink-0">
                  <div>
                    {a.current_bid_amount != null
                      ? `${a.current_bid_amount} ${a.bid_currency}`
                      : `Start ${a.start_price} ${a.bid_currency}`}
                  </div>
                  <div className="text-xs text-muted-foreground">{formatEnds(a.ends_at)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
