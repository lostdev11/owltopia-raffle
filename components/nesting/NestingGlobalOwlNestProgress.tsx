'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { OwlNest365PublicStats } from '@/lib/nesting/owl-nest-365-stats'

const POLL_MS = 30_000

type Props = {
  initialStats?: OwlNest365PublicStats | null
  className?: string
}

export function NestingGlobalOwlNestProgress({ initialStats = null, className }: Props) {
  const [stats, setStats] = useState<OwlNest365PublicStats | null>(initialStats)
  const [loading, setLoading] = useState(!initialStats)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/nesting/owl-nest-365-stats', { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as OwlNest365PublicStats
      setStats(json)
    } catch {
      /* keep last good stats */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const capacity = stats?.capacity ?? 1000
  const staked = stats?.staked ?? 0
  const remaining = stats?.remaining ?? capacity
  const lockDays = stats?.lock_period_days ?? 365
  const pct = Math.min(100, Math.max(0, stats?.percent_staked ?? 0))

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-card/95 via-card/80 to-black/50 p-5 sm:p-6 shadow-[0_0_48px_rgba(0,255,136,0.08)]',
        className
      )}
      aria-labelledby="nesting-global-progress-heading"
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] bg-[linear-gradient(110deg,transparent_35%,rgba(0,255,136,0.14)_50%,transparent_65%)]" />
      <div className="relative space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Owl Nest · community total
            </p>
            <h2
              id="nesting-global-progress-heading"
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
          aria-label={`${staked} of ${capacity} Owltopia coins nested across all wallets`}
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
          <span className="font-medium text-foreground/90">{lockDays}-day lock</span>
          {' · '}
          1 OWL per day per nested Owltopia coin. This bar is the{' '}
          <span className="font-medium text-foreground/90">total nests open on Owl Nest</span> from every wallet—not
          just yours.
        </p>
      </div>
    </section>
  )
}
