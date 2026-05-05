'use client'

import { cn } from '@/lib/utils'
import type { Gen2PresaleStats } from '@/lib/gen2-presale/types'

type Props = {
  stats: Gen2PresaleStats | null
  loading?: boolean
  className?: string
}

export function Gen2ProgressCard({ stats, loading, className }: Props) {
  const supply = stats?.presale_supply ?? 657
  const sold = stats?.sold ?? 0
  const remaining = stats?.remaining ?? supply
  const pct = Math.min(100, Math.max(0, stats?.percent_sold ?? 0))

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-[#00E58B]/30 bg-[#151D24]/90 p-6 shadow-[0_0_40px_rgba(0,0,0,0.45)]',
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] bg-[linear-gradient(110deg,transparent_35%,rgba(0,255,156,0.12)_50%,transparent_65%)]" />
      <div className="relative space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#A9CBB9]">Presale progress</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-[#EAFBF4]">
              {loading ? '—' : `${sold}`}{' '}
              <span className="text-base font-semibold text-[#A9CBB9]">/ {supply} spots</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-[#FFD769]/90">Only live</p>
            <p className="text-xl font-bold tabular-nums text-[#00FF9C]">{loading ? '—' : remaining}</p>
          </div>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-[#10161C] ring-1 ring-[#00E58B]/20">
          <div
            className="relative h-full rounded-full bg-gradient-to-r from-[#1F6F54] via-[#00E58B] to-[#00FF9C] shadow-[0_0_20px_rgba(0,255,156,0.45)] transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          >
            <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.25),transparent)] animate-gen2-shimmer opacity-80" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-lg border border-[#00FF9C]/30 bg-[#10161C]/90 px-3 py-1.5 text-sm font-bold tabular-nums text-[#00FF9C]">
            {loading ? '—' : `$${stats?.unit_price_usdc ?? 20}`} dollars in SOL / spot
          </span>
          <span className="text-sm text-[#A9CBB9]">USD value; you pay in SOL.</span>
        </div>
        <p className="text-sm leading-relaxed text-[#A9CBB9]">
          Secure your Gen2 allocation before WL and public.{' '}
          <span className="font-medium text-[#EAFBF4]">{supply} total presale spots</span> — demand is tracked live.
        </p>
      </div>
    </div>
  )
}
