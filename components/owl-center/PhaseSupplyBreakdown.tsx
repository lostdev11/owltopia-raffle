'use client'

import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
import type { OwlCenterPhase } from '@/lib/owl-center/types'
import { cn } from '@/lib/utils'

export type PhaseSupplyRow = {
  phase: OwlCenterPhase
  minted: number
  cap: number
  remaining?: number
}

/** Per-phase mint progress bars — shows minted / cap and how many spots remain in each phase. */
export function PhaseSupplyBreakdown({ rows, className }: { rows: PhaseSupplyRow[]; className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      {rows.map((row) => {
        const cap = Math.max(0, row.cap)
        const minted = Math.max(0, row.minted)
        const remaining = Math.max(0, row.remaining ?? cap - minted)
        const pct = cap > 0 ? Math.min(100, Math.max(0, (minted / cap) * 100)) : 0
        const soldOut = cap > 0 && remaining === 0
        return (
          <div key={row.phase} className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 font-mono text-xs tabular-nums">
              <span className="uppercase tracking-widest text-[#C5D0D8]">{owlCenterPhaseLabel(row.phase)}</span>
              <span className="text-[#9BA8B4]">
                {minted} / {cap}
                {' · '}
                <span className={soldOut ? 'text-[#FF9C9C]' : 'text-[#00FF9C]'}>
                  {soldOut ? 'sold out' : `${remaining} left`}
                </span>
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
      })}
    </div>
  )
}
