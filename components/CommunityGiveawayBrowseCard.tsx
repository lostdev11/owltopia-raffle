'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Gift, Loader2, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

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
      className="block h-full min-h-[44px] touch-manipulation"
    >
      <Card className="group flex h-full flex-col overflow-hidden border-green-500/25 bg-card/50 p-0 transition-colors hover:border-green-500/50 hover:bg-card/80 rounded-xl sm:rounded-[1.25rem]">
        {/* Same hero treatment as raffle list cards: full-width square artwork */}
        <div className="relative z-10 m-0 w-full aspect-square overflow-hidden rounded-t-xl sm:rounded-t-[1.25rem] bg-muted p-0">
          {artUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote NFT URIs (ipfs/https) from Helius
            <img
              src={artUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : artLoading ? (
            <div className="flex h-full min-h-[12rem] w-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-10 w-10 animate-spin" aria-hidden />
            </div>
          ) : (
            <div className="flex h-full min-h-[12rem] w-full items-center justify-center bg-green-500/10">
              <Gift className="h-16 w-16 text-green-500/70 sm:h-20 sm:w-20" aria-hidden />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-3 pt-10 sm:p-4 sm:pt-14">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h3 className="line-clamp-2 text-base font-semibold text-white drop-shadow-sm sm:text-lg">
                {g.title}
              </h3>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  canEnter
                    ? 'bg-green-500/90 text-white'
                    : g.status === 'drawn'
                      ? 'bg-white/20 text-white'
                      : 'bg-amber-500/90 text-white'
                }`}
              >
                {statusLabel(g)}
              </span>
            </div>
          </div>
        </div>
        <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-4">
          {g.description?.trim() ? (
            <p className="text-sm text-muted-foreground line-clamp-3">{g.description.trim()}</p>
          ) : null}
          <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:text-sm">
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
          <p className="mt-auto text-sm font-medium text-green-400 group-hover:underline">
            {canEnter ? 'Enter giveaway →' : 'View details →'}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}
