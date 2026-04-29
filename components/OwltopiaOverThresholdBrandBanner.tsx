'use client'

import Image from 'next/image'
import type { ReactNode } from 'react'

/** Keep in sync with `components/Logo.tsx` (animated GIF: avoid layout that recalculates on every frame). */
const BANNER_LOGO_SRC = '/logo.gif' as const

type OwltopiaOverThresholdBrandBannerProps = {
  topLeft?: ReactNode
  bottomContent?: ReactNode
  className?: string
}

/**
 * Over-threshold hero: same asset as the header. Uses a fixed box + `object-contain` (not `width/height: auto`
 * on the `img`) so the animated GIF does not reflow the strip each frame, which can look like glitching.
 */
export function OwltopiaOverThresholdBrandBanner({
  topLeft,
  bottomContent,
  className = '',
}: OwltopiaOverThresholdBrandBannerProps) {
  return (
    <div
      className={`relative w-full aspect-[3/2] max-h-[min(18rem,80vw)] max-sm:min-h-[160px] select-none overflow-hidden sm:aspect-[4/1] sm:min-h-0 sm:max-h-[240px] ${className}`}
    >
      <div className="absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/95 via-emerald-950/30 to-black" />
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 60% 90% at 50% 50%, rgba(6, 50, 40, 0.5) 0%, transparent 65%)`,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 30% 70% at 50% 50%, rgba(0, 255, 150, 0.08) 0%, transparent 60%)`,
          }}
        />
        <div className="absolute inset-0 z-[1] flex min-h-0 min-w-0 max-sm:pt-7 max-sm:pb-1 items-center justify-center px-2 sm:px-3 sm:pt-0 sm:pb-0">
          <div className="relative h-full w-full min-h-0 min-w-0 max-w-4xl py-0.5">
            <Image
              src={BANNER_LOGO_SRC}
              alt="OWLTOPIA"
              fill
              unoptimized
              className="pointer-events-none object-contain object-center"
              sizes="(max-width: 900px) calc(100vw - 1.5rem), 56rem"
              priority
              draggable={false}
            />
          </div>
        </div>
      </div>

      {topLeft && <div className="absolute left-2.5 top-2.5 z-20 sm:left-3.5 sm:top-3.5">{topLeft}</div>}

      {bottomContent && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/35 to-transparent pb-3 pl-2.5 pr-2.5 pt-7 sm:from-black/80 sm:via-black/20 sm:pb-3.5 sm:pl-4 sm:pr-4 sm:pt-6">
          {bottomContent}
        </div>
      )}
    </div>
  )
}
