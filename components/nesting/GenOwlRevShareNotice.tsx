'use client'

import { useEffect, useState } from 'react'
import { Coins } from 'lucide-react'

import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import {
  formatGenOwlRevShareSol,
  formatGenOwlRevShareUsdc,
  type GenOwlRevSharePreview,
} from '@/lib/nesting/gen-owl-rev-share'
import { cn } from '@/lib/utils'

type Snapshot = {
  next_date: string | null
  gen1: GenOwlRevSharePreview
  gen2: GenOwlRevSharePreview
}

type Props = {
  groupKey: GenOwlStakingGroupKey
  className?: string
  compact?: boolean
}

function hasRevShareAmounts(preview: GenOwlRevSharePreview): boolean {
  return (
    (preview.totals.total_sol != null && preview.totals.total_sol > 0) ||
    (preview.totals.total_usdc != null && preview.totals.total_usdc > 0)
  )
}

export function GenOwlRevShareNotice({ groupKey, className, compact = false }: Props) {
  const [preview, setPreview] = useState<GenOwlRevSharePreview | null>(null)
  const [nextDate, setNextDate] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/nesting/gen-owl-rev-share', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: Snapshot) => {
        if (cancelled) return
        const row = groupKey === 'gen1-owl' ? data.gen1 : data.gen2
        setPreview(row ?? null)
        setNextDate(data.next_date ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(null)
          setNextDate(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [groupKey])

  if (!preview || !hasRevShareAmounts(preview)) return null

  const perSol = preview.per_nest_sol
  const perUsdc = preview.per_nest_usdc
  const count = preview.active_nest_count

  return (
    <div
      className={cn(
        'rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5 text-xs leading-relaxed',
        className
      )}
      role="status"
    >
      <div className="flex items-center gap-1.5 font-semibold text-emerald-400/95">
        <Coins className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Rev share (even split · claim after month ends)
      </div>
      {nextDate ? (
        <p className="mt-1 text-muted-foreground">
          Next payout: <span className="font-medium text-foreground/90">{nextDate}</span>
        </p>
      ) : null}
      <p className="mt-1 text-muted-foreground">
        Pool:{' '}
        {preview.totals.total_sol != null && preview.totals.total_sol > 0 ? (
          <span className="font-medium tabular-nums text-foreground/90">
            {formatGenOwlRevShareSol(preview.totals.total_sol)} SOL
          </span>
        ) : null}
        {preview.totals.total_sol != null &&
        preview.totals.total_sol > 0 &&
        preview.totals.total_usdc != null &&
        preview.totals.total_usdc > 0
          ? ' · '
          : null}
        {preview.totals.total_usdc != null && preview.totals.total_usdc > 0 ? (
          <span className="font-medium tabular-nums text-foreground/90">
            {formatGenOwlRevShareUsdc(preview.totals.total_usdc)} USDC
          </span>
        ) : null}
      </p>
      {count > 0 && (perSol != null || perUsdc != null) ? (
        <p className="mt-1 text-foreground/90">
          ~{' '}
          {perSol != null ? (
            <span className="font-semibold tabular-nums text-theme-prime">
              {formatGenOwlRevShareSol(perSol)} SOL
            </span>
          ) : null}
          {perSol != null && perUsdc != null ? ' · ' : null}
          {perUsdc != null ? (
            <span className="font-semibold tabular-nums text-theme-prime">
              {formatGenOwlRevShareUsdc(perUsdc)} USDC
            </span>
          ) : null}{' '}
          per nested {groupKey === 'gen1-owl' ? 'Gen 1 owl' : 'Gen 2 owl'} ({count} active nest
          {count === 1 ? '' : 's'} today)
        </p>
      ) : (
        <p className="mt-1 text-muted-foreground">
          Split evenly across eligible nests at month-end. Claim opens on the 1st of the next month (UTC) in{' '}
          <span className="font-medium text-foreground/90">Monthly rev share</span> above.
        </p>
      )}
    </div>
  )
}

/** Admin preview row — same math, no fetch (pass snapshot from API). */
export function GenOwlRevShareAdminPreview({
  preview,
  className,
}: {
  preview: GenOwlRevSharePreview
  className?: string
}) {
  const hasTotals = hasRevShareAmounts(preview)
  return (
    <div className={cn('rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs', className)}>
      <p className="font-medium text-foreground">{preview.label} rev share preview</p>
      <p className="mt-1 text-muted-foreground tabular-nums">
        Active nests: <span className="font-semibold text-foreground">{preview.active_nest_count}</span>
      </p>
      {hasTotals ? (
        <p className="mt-1 text-muted-foreground">
          Even split →{' '}
          {preview.per_nest_sol != null ? (
            <span className="font-semibold tabular-nums text-emerald-400">
              {formatGenOwlRevShareSol(preview.per_nest_sol)} SOL
            </span>
          ) : (
            <span>— SOL</span>
          )}
          {' · '}
          {preview.per_nest_usdc != null ? (
            <span className="font-semibold tabular-nums text-emerald-400">
              {formatGenOwlRevShareUsdc(preview.per_nest_usdc)} USDC
            </span>
          ) : (
            <span>— USDC</span>
          )}{' '}
          per nest
          {preview.active_nest_count <= 0 ? ' (no active nests yet)' : null}
        </p>
      ) : (
        <p className="mt-1 text-muted-foreground">Enter totals above to preview per-nest payout.</p>
      )}
    </div>
  )
}
