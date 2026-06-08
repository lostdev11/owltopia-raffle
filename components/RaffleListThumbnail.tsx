'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Raffle } from '@/lib/types'
import { buildRaffleImageAttemptChain, getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'
import { useImageAttemptTimeout } from '@/lib/use-image-attempt-timeout'
import { cn } from '@/lib/utils'

export type RaffleListThumbnailRaffle = Pick<
  Raffle,
  'id' | 'image_url' | 'image_fallback_url' | 'prize_type' | 'prize_currency'
>

/** Ordered image URLs for compact raffle thumbs (matches RaffleCard / cart browse). */
export function raffleListImageChain(raffle: RaffleListThumbnailRaffle): string[] {
  const fromDb = getRaffleDisplayImageUrl(raffle.image_url)
  const prizeCurrency = (raffle.prize_currency || '').trim().toUpperCase()
  const isLegacyOwltopiaPlaceholder =
    typeof raffle.image_url === 'string' &&
    (/\/logo\.gif$/i.test(raffle.image_url.trim()) || /\/icon\.png$/i.test(raffle.image_url.trim()))
  const cryptoCurrencyArt =
    (raffle.prize_type === 'crypto' || raffle.prize_type == null) &&
    (prizeCurrency === 'SOL' || prizeCurrency === 'USDC')
      ? prizeCurrency === 'SOL'
        ? '/solana-mark.svg'
        : '/usdc.png'
      : null
  if (cryptoCurrencyArt && (!fromDb || isLegacyOwltopiaPlaceholder)) {
    return [cryptoCurrencyArt]
  }
  return buildRaffleImageAttemptChain(raffle.image_url, raffle.image_fallback_url).filter(Boolean)
}

const SIZE_CLASS = {
  sm: 'h-14 w-14',
  md: 'h-16 w-16',
} as const

const IMG_PX = {
  sm: 56,
  md: 64,
} as const

type RaffleListThumbnailProps = {
  raffle: RaffleListThumbnailRaffle
  size?: keyof typeof SIZE_CLASS
  className?: string
  /** Shown when every URL in the chain fails (e.g. "NFT"). */
  fallbackLabel?: string
  loading?: 'lazy' | 'eager'
}

/**
 * Compact raffle artwork with gateway fallback chain + mobile timeout.
 * Uses raw `<img>` — `next/image` often fails on proxy/GIF URLs in tight layouts.
 */
export function RaffleListThumbnail({
  raffle,
  size = 'md',
  className,
  fallbackLabel,
  loading = 'lazy',
}: RaffleListThumbnailProps) {
  const chain = useMemo(() => raffleListImageChain(raffle), [raffle])
  const chainKey = chain.join('\0')
  const [idx, setIdx] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [dead, setDead] = useState(false)

  useEffect(() => {
    setIdx(0)
    setLoaded(false)
    setDead(false)
  }, [raffle.id, chainKey])

  const tryNext = useCallback(() => {
    setLoaded(false)
    setIdx(i => {
      if (i + 1 < chain.length) return i + 1
      setDead(true)
      return i
    })
  }, [chain.length])

  const onImgEvent = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (e.type === 'error') {
        tryNext()
        return
      }
      const el = e.currentTarget
      if (el.naturalWidth < 2 || el.naturalHeight < 2) {
        tryNext()
        return
      }
      setLoaded(true)
    },
    [tryNext]
  )

  useImageAttemptTimeout(
    Boolean(chain[idx]) && !dead && !loaded,
    `${idx}:${chain[idx] ?? ''}`,
    tryNext
  )

  const src = chain[idx]
  const useContain = Boolean(
    src?.endsWith('.svg') || src === '/solana-mark.svg' || src === '/usdc.png'
  )

  if (!src || chain.length === 0 || dead) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-[10px] font-semibold text-muted-foreground',
          SIZE_CLASS[size],
          className
        )}
        aria-hidden={!fallbackLabel}
      >
        {fallbackLabel ?? '—'}
      </div>
    )
  }

  const px = IMG_PX[size]

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-lg border border-border bg-muted',
        SIZE_CLASS[size],
        className
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- NFT/proxy/GIF URLs; matches RaffleCard list thumb */}
      <img
        key={`${idx}-${src}`}
        src={src}
        alt=""
        width={px}
        height={px}
        loading={loading}
        decoding="async"
        className={cn(
          'h-full w-full',
          useContain ? 'object-contain p-1.5' : 'object-cover object-center'
        )}
        onError={onImgEvent}
        onLoad={onImgEvent}
      />
    </div>
  )
}
