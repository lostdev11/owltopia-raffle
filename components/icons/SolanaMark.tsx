'use client'

import { cn } from '@/lib/utils'

const MARK_SRC = '/solana-mark.svg'
const VIEW_W = 397
const VIEW_H = 311

function markHeightForWidth(w: number): number {
  return Math.max(1, Math.round((w * VIEW_H) / VIEW_W))
}

type SolanaMarkProps = {
  /** Pixel width of the mark; height is derived from the official 397:311 artwork. */
  size?: number
  className?: string
  title?: string
}

/**
 * Solana three-bar mark. Uses a static SVG as an `<img>` so scaling is handled by the browser paint
 * (avoids tiny inline-SVG + gradient + subpixel layout issues next to balance text).
 */
export function SolanaMark({ size, className, title = 'SOL' }: SolanaMarkProps) {
  const imgClass = cn('block shrink-0 select-none object-contain object-left', className)

  if (size != null) {
    const h = markHeightForWidth(size)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small fixed SVG asset; avoids duplicate gradient IDs vs inline SVG
      <img
        src={MARK_SRC}
        alt=""
        title={title}
        width={size}
        height={h}
        className={imgClass}
        draggable={false}
      />
    )
  }

  return (
    <span className={cn('solana-mark-frame', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- fills pixel-snapped frame from globals.css */}
      <img
        src={MARK_SRC}
        alt=""
        title={title}
        className="absolute inset-0 h-full w-full object-contain object-left"
        draggable={false}
      />
    </span>
  )
}
