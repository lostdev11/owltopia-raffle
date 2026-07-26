'use client'

import { useCallback, useEffect, useState } from 'react'
import { Coins, Loader2 } from 'lucide-react'

import {
  formatGenOwlRevShareSol,
  formatGenOwlRevShareUsdc,
} from '@/lib/nesting/gen-owl-rev-share'
import type { GenOwlRevShareEstimateResult } from '@/lib/nesting/gen-owl-rev-share-estimate'
import { genOwlRevShareDistributionSummary } from '@/lib/nesting/gen-owl-rev-share-copy'
import { cn } from '@/lib/utils'

type Props = {
  connected: boolean
  needsSignIn: boolean
  className?: string
}

export function GenOwlRevShareEstimatePanel({ connected, needsSignIn, className }: Props) {
  const [loading, setLoading] = useState(false)
  const [estimate, setEstimate] = useState<GenOwlRevShareEstimateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!connected || needsSignIn) {
      setEstimate(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/me/nesting/gen-owl-rev-share/estimate', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load rev share estimate.')
        setEstimate(null)
        return
      }
      setEstimate(data.estimate ?? null)
    } catch {
      setError('Network error loading rev share estimate.')
      setEstimate(null)
    } finally {
      setLoading(false)
    }
  }, [connected, needsSignIn])

  useEffect(() => {
    void load()
  }, [load])

  if (!connected) return null
  if (!needsSignIn && !loading && !estimate && !error) return null

  return (
    <div
      className={cn(
        'rounded-xl border border-border/60 bg-muted/15 px-3 py-3 sm:px-4 sm:py-4',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-emerald-400/90 shrink-0" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Your rev share this month</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        Projected from the deposited pool and today&apos;s nest counts. Final amounts lock at month-end; claim
        opens on the 1st (UTC). {genOwlRevShareDistributionSummary('gen1-owl')}
      </p>

      {needsSignIn ? (
        <p className="mt-2 text-xs text-amber-400/95">Sign in to see your projected rev share.</p>
      ) : loading ? (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading estimate…
        </p>
      ) : estimate ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-foreground/90">
            {estimate.period_label}
            {estimate.is_estimate ? ' (estimate)' : ''}:{' '}
            {estimate.total_sol > 0 ? (
              <span className="font-semibold tabular-nums text-theme-prime">
                {formatGenOwlRevShareSol(estimate.total_sol)} SOL
              </span>
            ) : null}
            {estimate.total_sol > 0 && estimate.total_usdc > 0 ? ' · ' : null}
            {estimate.total_usdc > 0 ? (
              <span className="font-semibold tabular-nums text-theme-prime">
                {formatGenOwlRevShareUsdc(estimate.total_usdc)} USDC
              </span>
            ) : null}{' '}
            across {estimate.nests.length} nest{estimate.nests.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-1.5">
            {estimate.nests.map((row) => (
              <li
                key={row.position_id}
                className="flex flex-col gap-0.5 rounded-lg border border-white/[0.06] bg-black/15 px-2.5 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-muted-foreground truncate">
                  {row.group === 'gen1-owl'
                    ? row.bucket === 'one_of_one'
                      ? 'Gen 1 1/1'
                      : 'Gen 1 owl'
                    : 'Gen 2 owl'}
                  {row.asset_identifier ? ` · ${row.asset_identifier.slice(0, 8)}…` : ''}
                </p>
                <p className="tabular-nums text-theme-prime/95 shrink-0">
                  {row.amount_sol > 0 ? `${formatGenOwlRevShareSol(row.amount_sol)} SOL` : null}
                  {row.amount_sol > 0 && row.amount_usdc > 0 ? ' · ' : null}
                  {row.amount_usdc > 0 ? `${formatGenOwlRevShareUsdc(row.amount_usdc)} USDC` : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-amber-400/95">{error}</p> : null}
    </div>
  )
}
