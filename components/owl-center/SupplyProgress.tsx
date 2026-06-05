'use client'

import { cn } from '@/lib/utils'

export function SupplyProgress({
  minted,
  total,
  className,
}: {
  minted: number
  total: number
  className?: string
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (minted / total) * 100)) : 0
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex justify-between font-mono text-xs tabular-nums text-[#9BA8B4]">
        <span>Minted</span>
        <span className="text-[#00FF9C]">
          {minted} / {total}
        </span>
      </div>
      <div className="h-2 overflow-hidden border border-[#1A222B] bg-[#0F1419]">
        <div
          className="h-full bg-gradient-to-r from-[#00C97A] via-[#00FF9C] to-[#1DFFB2] transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
