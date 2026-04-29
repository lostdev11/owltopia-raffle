'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { Gift, Loader2, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { buildRaffleImageAttemptChain } from '@/lib/raffle-display-image-url'

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

export function CommunityGiveawayBrowseCard({
  g,
  priorityImage = false,
}: {
  g: CommunityGiveawayBrowseItem
  /** First card: eager image load for mobile LCP */
  priorityImage?: boolean
}) {
  const [imageAttemptChain, setImageAttemptChain] = useState<string[]>([])
  const [imageAttemptIdx, setImageAttemptIdx] = useState(0)
  const [artLoading, setArtLoading] = useState(true)
  const touchStartRef = useRef({ x: 0, y: 0 })
  const scrollDetectedRef = useRef(false)
  const TOUCH_MOVE_THRESHOLD = 12

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    touchStartRef.current = { x: t.clientX, y: t.clientY }
    scrollDetectedRef.current = false
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    const { x, y } = touchStartRef.current
    if (Math.hypot(t.clientX - x, t.clientY - y) > TOUCH_MOVE_THRESHOLD) {
      scrollDetectedRef.current = true
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (scrollDetectedRef.current) {
      e.preventDefault()
    }
  }

  const handleLinkClick = (e: React.MouseEvent) => {
    if (scrollDetectedRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  useEffect(() => {
    let cancelled = false
    const mint = g.nft_mint_address?.trim()
    if (!mint) {
      setImageAttemptChain([])
      setImageAttemptIdx(0)
      setArtLoading(false)
      return
    }
    setImageAttemptIdx(0)
    fetch(`/api/nft/metadata-image?mint=${encodeURIComponent(mint)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { image?: string | null } | null) => {
        if (cancelled) return
        const raw = json?.image?.trim()
        if (!raw) {
          setImageAttemptChain([])
          return
        }
        setImageAttemptChain(buildRaffleImageAttemptChain(raw, null))
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
      className="block h-full min-h-[44px] touch-manipulation [-webkit-tap-highlight-color:transparent]"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleLinkClick}
    >
      <Card className="group flex h-full flex-col overflow-hidden border-green-500/25 bg-card/50 p-0 rounded-xl transition-[transform,colors,box-shadow] duration-200 ease-out active:scale-[0.99] hover:border-green-500/50 hover:bg-card/80 sm:rounded-[1.25rem] sm:hover:scale-[1.01] sm:active:scale-100">
        {/* Full-width square hero — same visual weight as raffle cards on phones */}
        <div className="relative z-10 m-0 w-full aspect-square min-h-[200px] overflow-hidden rounded-t-xl bg-muted p-0 sm:min-h-0 sm:rounded-t-[1.25rem]">
          {!artLoading &&
          imageAttemptChain.length > 0 &&
          imageAttemptIdx < imageAttemptChain.length ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote NFT URIs (ipfs/https) via proxy chain
            <img
              key={`${g.id}-${imageAttemptIdx}-${imageAttemptChain[imageAttemptIdx]?.slice(0, 48)}`}
              src={imageAttemptChain[imageAttemptIdx]}
              alt=""
              className="h-full w-full object-cover"
              loading={priorityImage ? 'eager' : 'lazy'}
              fetchPriority={priorityImage ? 'high' : undefined}
              decoding={priorityImage ? 'sync' : 'async'}
              onError={() => setImageAttemptIdx((i) => i + 1)}
            />
          ) : artLoading ? (
            <div className="flex h-full min-h-[200px] w-full items-center justify-center text-muted-foreground sm:min-h-0">
              <Loader2 className="h-10 w-10 animate-spin" aria-hidden />
            </div>
          ) : (
            <div className="flex h-full min-h-[200px] w-full items-center justify-center bg-green-500/10 sm:min-h-0">
              <Gift className="h-16 w-16 text-green-500/70 sm:h-20 sm:w-20" aria-hidden />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-4 pt-12 sm:p-4 sm:pt-14">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
              <h3 className="line-clamp-3 text-base font-semibold leading-snug text-white drop-shadow-md sm:line-clamp-2 sm:text-lg">
                {g.title}
              </h3>
              <span
                className={`w-fit max-w-full rounded-full px-2.5 py-1 text-[11px] font-medium leading-tight sm:shrink-0 sm:px-2 sm:py-0.5 sm:text-xs ${
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
            <p className="text-base leading-relaxed text-muted-foreground line-clamp-3 sm:text-sm">
              {g.description.trim()}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2 text-base text-muted-foreground sm:gap-1.5 sm:text-sm">
            <li className="flex items-center gap-2">
              <Users className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden />
              <span>
                {g.entryCount} {g.entryCount === 1 ? 'entry' : 'entries'}
              </span>
            </li>
            <li className="leading-snug">
              Access:{' '}
              <span className="text-foreground">
                {g.access_gate === 'holder_only' ? 'Owl NFT holders' : 'Everyone'}
              </span>
            </li>
            <li className="leading-snug">
              OWL boost deadline: <span className="text-foreground">{formatWhen(g.starts_at)}</span>
            </li>
            {g.ends_at ? (
              <li className="leading-snug">
                Entry deadline: <span className="text-foreground">{formatWhen(g.ends_at)}</span>
              </li>
            ) : null}
          </ul>
          <p className="mt-auto flex min-h-[44px] items-center text-base font-medium text-green-400 sm:min-h-0 sm:text-sm group-hover:underline">
            {canEnter ? 'Enter giveaway →' : 'View details →'}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}
