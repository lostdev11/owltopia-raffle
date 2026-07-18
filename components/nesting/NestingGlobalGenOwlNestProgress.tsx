'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import type { GenOwlNestPublicStats } from '@/lib/nesting/gen-owl-nest-stats'

const POLL_MS = 30_000

const DEFAULT_CAPACITY: Record<GenOwlStakingGroupKey, number> = {
  'gen1-owl': 343,
  'gen2-owl': 2000,
}

const COPY: Record<
  GenOwlStakingGroupKey,
  { eyebrow: string; assetPlural: string; rateLine: string }
> = {
  'gen1-owl': {
    eyebrow: 'Gen 1 Owl · community total',
    assetPlural: 'Gen 1 owls',
    rateLine: '0.2 OWL/day (90d) or 0.6 OWL/day (180d) per nested Gen 1 owl.',
  },
  'gen2-owl': {
    eyebrow: 'Gen 2 Owl · community total',
    assetPlural: 'Gen 2 owls',
    rateLine: '0.1 OWL/day (90d) or 0.3 OWL/day (180d) per nested Gen 2 owl.',
  },
}

type Props = {
  groupKey: GenOwlStakingGroupKey
  initialStats?: GenOwlNestPublicStats | null
  className?: string
}

export function NestingGlobalGenOwlNestProgress({
  groupKey,
  initialStats = null,
  className,
}: Props) {
  const [stats, setStats] = useState<GenOwlNestPublicStats | null>(initialStats)
  const [loading, setLoading] = useState(!initialStats)
  const copy = COPY[groupKey]
  const headingId = `nesting-global-${groupKey}-progress-heading`

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/nesting/gen-owl-nest-stats?group=${encodeURIComponent(groupKey)}`,
        { cache: 'no-store' }
      )
      if (!res.ok) return
      const json = (await res.json()) as GenOwlNestPublicStats
      setStats(json)
    } catch {
      /* keep last good stats */
    } finally {
      setLoading(false)
    }
  }, [groupKey])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const capacity = stats?.capacity ?? DEFAULT_CAPACITY[groupKey]
  const staked = stats?.staked ?? 0
  const remaining = stats?.remaining ?? capacity
  const lockTiers =
    stats?.lock_tiers_days?.length ? stats.lock_tiers_days : [90, 180]
  const lockLabel = lockTiers.map((d) => `${d}-day`).join(' or ')
  const pct = Math.min(100, Math.max(0, stats?.percent_staked ?? 0))

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-card/95 via-card/80 to-black/50 p-5 sm:p-6 shadow-[0_0_48px_rgba(0,255,136,0.08)]',
        className
      )}
      aria-labelledby={headingId}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] bg-[linear-gradient(110deg,transparent_35%,rgba(0,255,136,0.14)_50%,transparent_65%)]" />
      <div className="relative space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {copy.eyebrow}
            </p>
            <h2
              id={headingId}
              className="mt-1 text-2xl font-black tabular-nums text-foreground sm:text-3xl"
            >
              {loading && !stats ? '—' : staked}{' '}
              <span className="text-base font-semibold text-muted-foreground sm:text-lg">
                / {capacity} nested
              </span>
            </h2>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-theme-prime/90">Slots left</p>
            <p className="text-xl font-bold tabular-nums text-theme-prime">
              {loading && !stats ? '—' : remaining}
            </p>
          </div>
        </div>
        <div
          className="h-3 overflow-hidden rounded-full bg-muted/50 ring-1 ring-emerald-500/25"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={capacity}
          aria-valuenow={staked}
          aria-label={`${staked} of ${capacity} ${copy.assetPlural} nested across all wallets`}
        >
          <div
            className={cn(
              'relative h-full rounded-full bg-gradient-to-r from-emerald-700/90 via-theme-prime to-emerald-400/90 shadow-[0_0_20px_rgba(0,255,136,0.35)] transition-[width] duration-700 ease-out',
              loading && !stats && 'animate-pulse opacity-70'
            )}
            style={{ width: loading && !stats ? '12%' : `${pct}%` }}
          />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/90">{lockLabel} lock</span>
          {' · '}
          {copy.rateLine} This bar is the{' '}
          <span className="font-medium text-foreground/90">
            total nests open across all {copy.assetPlural} lock tiers
          </span>{' '}
          from every wallet—not just yours.
        </p>
      </div>
    </section>
  )
}
