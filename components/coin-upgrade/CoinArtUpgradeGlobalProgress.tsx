'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CoinArtUpgradePublicProgress } from '@/lib/coin-upgrade/public-progress-types'

const POLL_MS = 30_000

type Props = {
  initialProgress?: CoinArtUpgradePublicProgress | null
  className?: string
  /** When true, omit the upgrade CTA link (e.g. already on the upgrade panel). */
  hideCta?: boolean
  compact?: boolean
}

export function CoinArtUpgradeGlobalProgress({
  initialProgress = null,
  className,
  hideCta = false,
  compact = false,
}: Props) {
  const [progress, setProgress] = useState<CoinArtUpgradePublicProgress | null>(initialProgress)
  const [loading, setLoading] = useState(!initialProgress)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/coin-upgrade/progress', { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as CoinArtUpgradePublicProgress
      setProgress(json)
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

  if (progress && !progress.visible) return null
  if (!progress && !loading) return null

  const capacity = progress?.capacity ?? 1000
  const upgraded = progress?.upgraded ?? 0
  const upgrading = progress?.upgrading ?? 0
  const remaining = progress?.remaining ?? capacity
  const pct = Math.min(100, Math.max(0, progress?.percent_upgraded ?? 0))

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-violet-500/35 bg-gradient-to-b from-card/95 via-card/80 to-black/50 shadow-[0_0_48px_rgba(139,92,246,0.1)]',
        compact ? 'p-4' : 'p-5 sm:p-6',
        className
      )}
      aria-labelledby="coin-art-upgrade-global-progress-heading"
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] bg-[linear-gradient(110deg,transparent_35%,rgba(167,139,250,0.2)_50%,transparent_65%)]" />
      <div className="relative space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-violet-400/90" aria-hidden />
              Coin art upgrade · community total
            </p>
            <h2
              id="coin-art-upgrade-global-progress-heading"
              className={cn(
                'mt-1 font-black tabular-nums text-foreground',
                compact ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'
              )}
            >
              {loading && !progress ? '—' : upgraded}{' '}
              <span className="text-base font-semibold text-muted-foreground sm:text-lg">
                / {capacity} upgraded
              </span>
            </h2>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-300/90">Left</p>
            <p className="text-xl font-bold tabular-nums text-violet-300">
              {loading && !progress ? '—' : remaining}
            </p>
          </div>
        </div>
        <div
          className="h-3 overflow-hidden rounded-full bg-muted/50 ring-1 ring-violet-500/30"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={capacity}
          aria-valuenow={upgraded}
          aria-label={`${upgraded} of ${capacity} Owltopia coins upgraded across all wallets`}
        >
          <div
            className={cn(
              'relative h-full rounded-full bg-gradient-to-r from-violet-700/90 via-violet-400 to-fuchsia-400/90 shadow-[0_0_20px_rgba(167,139,250,0.35)] transition-[width] duration-700 ease-out',
              loading && !progress && 'animate-pulse opacity-70'
            )}
            style={{ width: loading && !progress ? '8%' : `${pct}%` }}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className={cn('leading-relaxed text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
            <span className="font-medium text-foreground/90">Live community counter</span>
            {upgrading > 0 ? (
              <>
                {' '}
                · <span className="font-medium text-foreground/90">{upgrading}</span> finishing on-chain now
              </>
            ) : null}
            . This bar is the total upgraded coins from every wallet—not just yours.
          </p>
          {!hideCta ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="min-h-[44px] shrink-0 touch-manipulation border-violet-500/40"
            >
              <Link href="/dashboard/nesting#coin-art-upgrade">Upgrade yours</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
