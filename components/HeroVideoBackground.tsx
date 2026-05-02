'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

export type HeroVideoBackgroundProps = {
  videoSrc: string
  posterSrc: string
  children: React.ReactNode
  className?: string
  /** Applied on top of the base `bg-black/65` dim layer (before the green gradient). */
  overlayClassName?: string
}

/**
 * Full-viewport cinematic video background with poster fallback.
 * - Desktop: muted autoplay loop when motion is allowed.
 * - Respects `prefers-reduced-motion` and uses poster only.
 * - Mobile (`max-width: 767px`): poster only for readability and battery/perf.
 * - Background layers use `pointer-events-none` so wallet UI and buttons stay clickable.
 */
export function HeroVideoBackground({
  videoSrc,
  posterSrc,
  children,
  className,
  overlayClassName,
}: HeroVideoBackgroundProps) {
  /** False until mounted so SSR/first paint match (poster only), then desktop allows video. */
  const [useVideo, setUseVideo] = useState(false)

  useEffect(() => {
    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const mqMobile = window.matchMedia('(max-width: 767px)')

    const compute = () => {
      setUseVideo(!mqReduce.matches && !mqMobile.matches)
    }

    compute()
    mqReduce.addEventListener('change', compute)
    mqMobile.addEventListener('change', compute)
    return () => {
      mqReduce.removeEventListener('change', compute)
      mqMobile.removeEventListener('change', compute)
    }
  }, [])

  return (
    <section className={cn('relative min-h-screen overflow-hidden bg-black', className)}>
      {/* Poster base — always rendered for first paint and mobile / reduced-motion */}
      <div
        className="absolute inset-0 z-0 bg-black bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${posterSrc})` }}
        aria-hidden
      />

      {useVideo ? (
        <video
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover"
          src={videoSrc}
          poster={posterSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
        />
      ) : null}

      <div
        className={cn('pointer-events-none absolute inset-0 z-[2] bg-black/65', overlayClassName)}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-b from-black/70 via-[#06140f]/60 to-black/90"
        aria-hidden
      />

      <div className="relative z-10">{children}</div>
    </section>
  )
}
