'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Gift, Loader2, Users } from 'lucide-react'

export type CommunityGiveawayBrowseItem = {
  id: string
  title: string
  description: string | null
  access_gate: string
  status: string
  starts_at: string
  ends_at: string | null
  nft_mint_address: string
  entryCount: number
  prizeDeposited: boolean
  winnerDrawn: boolean
  claimed: boolean
}

function formatWhen(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function statusLabel(g: CommunityGiveawayBrowseItem): string {
  if (g.status === 'cancelled') return 'Cancelled'
  if (g.status === 'drawn') return g.claimed ? 'Prize claimed' : 'Winner drawn'
  if (g.status === 'open') return g.prizeDeposited ? 'Open — enter now' : 'Opening soon'
  return g.status
}

export function CommunityGiveawayBrowseCard({ g }: { g: CommunityGiveawayBrowseItem }) {
  const [artUrl, setArtUrl] = useState<string | null>(null)
  const [artLoading, setArtLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const mint = g.nft_mint_address?.trim()
    if (!mint) {
      setArtLoading(false)
      return
    }
    fetch(`/api/nft/metadata-image?mint=${encodeURIComponent(mint)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { image?: string | null } | null) => {
        if (cancelled || !json?.image?.trim()) return
        setArtUrl(json.image.trim())
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setArtLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [g.nft_mint_address])

  const canEnter = g.status === 'open' && g.prizeDeposited && !g.winnerDrawn

  return (
    <Link
      href={`/community-giveaway/${encodeURIComponent(g.id)}`}
      className="group flex flex-col sm:flex-row gap-4 rounded-xl border border-green-500/25 bg-card/50 p-4 touch-manipulation min-h-[44px] hover:border-green-500/50 hover:bg-card/80 transition-colors"
    >
      <div className="relative w-full sm:w-36 h-36 shrink-0 rounded-lg overflow-hidden bg-muted border border-border">
        {artUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote NFT URIs (ipfs/https) from Helius
          <img src={artUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : artLoading ? (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-green-500/10">
            <Gift className="h-12 w-12 text-green-500/70" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-base sm:text-lg text-foreground group-hover:text-green-400 transition-colors line-clamp-2">
            {g.title}
          </h3>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              canEnter
                ? 'bg-green-500/20 text-green-300'
                : g.status === 'drawn'
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-amber-500/15 text-amber-200'
            }`}
          >
            {statusLabel(g)}
          </span>
        </div>
        {g.description?.trim() ? (
          <p className="text-sm text-muted-foreground line-clamp-2">{g.description.trim()}</p>
        ) : null}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {g.entryCount} {g.entryCount === 1 ? 'entry' : 'entries'}
          </li>
          <li>
            Access:{' '}
            <span className="text-foreground">
              {g.access_gate === 'holder_only' ? 'Owl NFT holders' : 'Everyone'}
            </span>
          </li>
          <li>
            OWL boost deadline: <span className="text-foreground">{formatWhen(g.starts_at)}</span>
          </li>
          {g.ends_at ? (
            <li>
              Entry deadline: <span className="text-foreground">{formatWhen(g.ends_at)}</span>
            </li>
          ) : null}
        </ul>
        <p className="text-sm font-medium text-green-400">
          {canEnter ? 'Tap to enter →' : 'View details →'}
        </p>
      </div>
    </Link>
  )
}
