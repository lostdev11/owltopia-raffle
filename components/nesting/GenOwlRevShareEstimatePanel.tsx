'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Coins, Loader2 } from 'lucide-react'

import {
  formatGenOwlRevShareSol,
  formatGenOwlRevShareUsdc,
} from '@/lib/nesting/gen-owl-rev-share'
import type {
  GenOwlRevShareEstimateResult,
  GenOwlRevShareEstimateRow,
} from '@/lib/nesting/gen-owl-rev-share-estimate'
import {
  GEN_OWL_REV_SHARE_SHORT_BLURB,
  genOwlRevShareDistributionSummary,
  genOwlRevShareGroupLabel,
} from '@/lib/nesting/gen-owl-rev-share-copy'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import { cn } from '@/lib/utils'

type Props = {
  connected: boolean
  needsSignIn: boolean
  className?: string
}

type NestGroup = {
  key: string
  group: GenOwlStakingGroupKey
  bucket: GenOwlRevShareEstimateRow['bucket']
  label: string
  count: number
  amount_sol: number
  amount_usdc: number
}

function groupEstimateNests(nests: GenOwlRevShareEstimateRow[]): NestGroup[] {
  const map = new Map<string, NestGroup>()
  for (const row of nests) {
    const bucket = row.bucket ?? 'standard'
    const key = `${row.group}:${bucket}`
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
      existing.amount_sol += row.amount_sol
      existing.amount_usdc += row.amount_usdc
      continue
    }
    map.set(key, {
      key,
      group: row.group,
      bucket: row.bucket,
      label: genOwlRevShareGroupLabel(row.group, row.bucket),
      count: 1,
      amount_sol: row.amount_sol,
      amount_usdc: row.amount_usdc,
    })
  }
  return Array.from(map.values())
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

  const grouped = useMemo(
    () => (estimate ? groupEstimateNests(estimate.nests) : []),
    [estimate]
  )

  const splitNotes = useMemo(() => {
    if (!estimate) return [] as string[]
    const groups = new Set(estimate.nests.map((n) => n.group))
    return Array.from(groups).map((g) => genOwlRevShareDistributionSummary(g))
  }, [estimate])

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
        {GEN_OWL_REV_SHARE_SHORT_BLURB}
        {splitNotes.length > 0 ? ` ${splitNotes.join(' ')}` : null}
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
            · {estimate.nests.length} nest{estimate.nests.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-1.5">
            {grouped.map((row) => {
              const perNestSol = row.count > 0 ? row.amount_sol / row.count : 0
              const perNestUsdc = row.count > 0 ? row.amount_usdc / row.count : 0
              return (
                <li
                  key={row.key}
                  className="flex flex-col gap-0.5 rounded-lg border border-white/[0.06] bg-black/15 px-2.5 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {row.label} · {row.count} nest{row.count === 1 ? '' : 's'}
                    </p>
                    {row.count > 1 && (perNestSol > 0 || perNestUsdc > 0) ? (
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        ≈{' '}
                        {perNestSol > 0 ? `${formatGenOwlRevShareSol(perNestSol)} SOL` : null}
                        {perNestSol > 0 && perNestUsdc > 0 ? ' · ' : null}
                        {perNestUsdc > 0 ? `${formatGenOwlRevShareUsdc(perNestUsdc)} USDC` : null}
                        {' '}
                        each
                      </p>
                    ) : null}
                  </div>
                  <p className="tabular-nums font-semibold text-theme-prime/95 shrink-0">
                    {row.amount_sol > 0 ? `${formatGenOwlRevShareSol(row.amount_sol)} SOL` : null}
                    {row.amount_sol > 0 && row.amount_usdc > 0 ? ' · ' : null}
                    {row.amount_usdc > 0 ? `${formatGenOwlRevShareUsdc(row.amount_usdc)} USDC` : null}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-amber-400/95">{error}</p> : null}
    </div>
  )
}
