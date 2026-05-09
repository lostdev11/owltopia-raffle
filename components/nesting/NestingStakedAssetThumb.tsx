'use client'

import { useEffect, useState } from 'react'
import { Egg, Loader2 } from 'lucide-react'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'
import { cn } from '@/lib/utils'

export type NestingStakedAssetThumbProps = {
  mint?: string | null
  /** From wallet DAS scan — skips metadata fetch when present. */
  hintImageUrl?: string | null
  name?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function NestingStakedAssetThumb({
  mint,
  hintImageUrl,
  name,
  size = 'md',
  className,
}: NestingStakedAssetThumbProps) {
  const dim =
    size === 'sm'
      ? 'h-16 w-16 min-h-[64px] min-w-[64px]'
      : size === 'lg'
        ? 'aspect-square h-auto w-full min-h-[100px] max-h-[176px]'
        : 'h-[5.5rem] w-[5.5rem] min-h-[88px] min-w-[88px]'

  const [displaySrc, setDisplaySrc] = useState<string | null>(() => {
    const h = hintImageUrl?.trim()
    return h ? getRaffleDisplayImageUrl(h) : null
  })
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>(() => {
    const h = hintImageUrl?.trim()
    if (h) return getRaffleDisplayImageUrl(h) ? 'ready' : 'error'
    return mint?.trim() ? 'loading' : 'idle'
  })

  useEffect(() => {
    const hint = hintImageUrl?.trim()
    if (hint) {
      const proxied = getRaffleDisplayImageUrl(hint)
      setDisplaySrc(proxied)
      setPhase(proxied ? 'ready' : 'error')
      return
    }

    const m = mint?.trim()
    if (!m) {
      setDisplaySrc(null)
      setPhase('idle')
      return
    }

    let cancelled = false
    setPhase('loading')
    setDisplaySrc(null)

    fetch(`/api/nft/metadata-image?mint=${encodeURIComponent(m)}&preferMainnet=1`)
      .then((r) => r.json())
      .then((j: { image?: string | null }) => {
        if (cancelled) return
        const uri = typeof j?.image === 'string' ? j.image : null
        const proxied = uri ? getRaffleDisplayImageUrl(uri) : null
        setDisplaySrc(proxied)
        setPhase(proxied ? 'ready' : 'error')
      })
      .catch(() => {
        if (!cancelled) {
          setDisplaySrc(null)
          setPhase('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [mint, hintImageUrl])

  const altLabel = name?.trim() ? `${name.trim()} artwork` : 'Staked NFT artwork'

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-xl border border-border/60 bg-muted/40',
        dim,
        className
      )}
    >
      {phase === 'loading' ? (
        <div className="flex h-full w-full items-center justify-center bg-muted/50 touch-manipulation">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">Loading NFT artwork</span>
        </div>
      ) : displaySrc ? (
        <img
          src={displaySrc}
          alt={altLabel}
          className="h-full w-full object-cover touch-manipulation"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/30 px-1 text-center touch-manipulation">
          <Egg className="h-8 w-8 text-muted-foreground/70" aria-hidden />
          <span className="sr-only">{phase === 'error' ? 'Artwork unavailable' : 'No artwork'}</span>
        </div>
      )}
    </div>
  )
}
