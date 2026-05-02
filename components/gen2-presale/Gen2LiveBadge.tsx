'use client'

import { cn } from '@/lib/utils'

type Props = {
  className?: string
  /** From `/api/gen2-presale/stats` → `presale_live`. Omit while loading. */
  live?: boolean
  loading?: boolean
}

export function Gen2LiveBadge({ className, live, loading }: Props) {
  if (loading || live === undefined) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-[#1F6F54]/60 bg-[#10161C]/90 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[#A9CBB9]',
          className
        )}
      >
        <span className="relative flex h-2 w-2 rounded-full bg-[#A9CBB9]/40" />
        Checking status…
      </span>
    )
  }

  if (!live) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-[#FFD769]/45 bg-[#FFD769]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[#FFD769]',
          className
        )}
      >
        <span className="relative flex h-2 w-2 rounded-full bg-[#FFD769]" />
        PRESALE PAUSED
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-[#00FF9C]/50 bg-[#00E58B]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[#00FF9C]',
        'motion-safe:animate-gen2-presale-badge-glow motion-reduce:animate-none motion-reduce:shadow-[0_0_20px_rgba(0,255,156,0.35)]',
        className
      )}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00FF9C] opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00FF9C]" />
      </span>
      <span className="motion-safe:animate-gen2-live-blink motion-reduce:animate-none">PRESALE LIVE</span>
    </span>
  )
}
