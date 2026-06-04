'use client'

import type { ReactNode } from 'react'
import { Coins, ListChecks, Timer } from 'lucide-react'

function StatChip({
  icon,
  label,
  value,
  highlight,
}: {
  icon: ReactNode
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <div
      className={`flex min-h-[44px] flex-1 min-w-[9rem] items-center gap-3 rounded-xl border px-3 py-2.5 touch-manipulation ${
        highlight
          ? 'border-emerald-500/35 bg-emerald-500/[0.08]'
          : 'border-border/60 bg-card/90'
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          highlight ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="block text-lg font-bold tabular-nums leading-tight">{value}</span>
      </span>
    </div>
  )
}

export function HostingQuickStats({
  hostedCount,
  readyToClaimCount,
  awaitingDrawCount,
}: {
  hostedCount: number
  readyToClaimCount: number
  awaitingDrawCount: number
}) {
  return (
    <div className="flex flex-wrap gap-2 sm:gap-3">
      <StatChip icon={<ListChecks className="h-4 w-4" aria-hidden />} label="Hosted" value={hostedCount} />
      <StatChip
        icon={<Coins className="h-4 w-4" aria-hidden />}
        label="Ready to claim"
        value={readyToClaimCount}
        highlight={readyToClaimCount > 0}
      />
      <StatChip
        icon={<Timer className="h-4 w-4" aria-hidden />}
        label="Awaiting draw"
        value={awaitingDrawCount}
        highlight={awaitingDrawCount > 0}
      />
    </div>
  )
}
