'use client'

import { cn } from '@/lib/utils'

export function MintAllocationBar({
  label,
  minted,
  total,
  hint,
  className,
}: {
  label: string
  minted: number
  total: number
  hint?: string
  className?: string
}) {
  const safeTotal = Math.max(0, total)
  const safeMinted = Math.max(0, Math.min(minted, safeTotal || minted))
  const pct = safeTotal > 0 ? Math.min(100, (safeMinted / safeTotal) * 100) : safeMinted > 0 ? 100 : 0
  const remaining = Math.max(0, safeTotal - safeMinted)

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-xs">
        <span className="text-[#5C6773]">{label}</span>
        <span className="tabular-nums text-[#C5D0D8]">
          <span className="text-[#00FF9C]">{safeMinted}</span>
          {safeTotal > 0 ? (
            <>
              {' '}
              / {safeTotal} minted
            </>
          ) : (
            <> minted</>
          )}
          {safeTotal > 0 ? <span className="text-[#5C6773]"> · {remaining} left</span> : null}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden border border-[#1A222B] bg-[#0B0F14]">
        <div
          className="h-full bg-[#00FF9C]/80 transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={safeMinted}
          aria-valuemin={0}
          aria-valuemax={safeTotal || safeMinted}
          aria-label={label}
        />
      </div>
      {hint ? <p className="text-[10px] leading-relaxed text-[#5C6773]">{hint}</p> : null}
    </div>
  )
}
