'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Coins, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  formatGenOwlRevShareSol,
  formatGenOwlRevShareUsdc,
} from '@/lib/nesting/gen-owl-rev-share'
import type { GenOwlRevShareClaimableRow } from '@/lib/nesting/gen-owl-rev-share-claimable'
import {
  GEN_OWL_REV_SHARE_SHORT_BLURB,
  genOwlRevShareDistributionSummary,
} from '@/lib/nesting/gen-owl-rev-share-copy'
import { nestingClaimReadyButtonClass } from '@/lib/nesting/ui-classes'
import { cn } from '@/lib/utils'

type Props = {
  connected: boolean
  needsSignIn: boolean
  className?: string
}

type MonthGroup = {
  period_month: string
  period_label: string
  nest_count: number
  amount_sol: number
  amount_usdc: number
}

function groupByMonth(rows: GenOwlRevShareClaimableRow[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>()
  for (const row of rows) {
    const existing = map.get(row.period_month)
    if (existing) {
      existing.nest_count += 1
      existing.amount_sol += row.amount_sol
      existing.amount_usdc += row.amount_usdc
      continue
    }
    map.set(row.period_month, {
      period_month: row.period_month,
      period_label: row.period_label,
      nest_count: 1,
      amount_sol: row.amount_sol,
      amount_usdc: row.amount_usdc,
    })
  }
  return Array.from(map.values())
}

export function GenOwlRevShareClaimPanel({ connected, needsSignIn, className }: Props) {
  const [loading, setLoading] = useState(false)
  const [claimsEnabled, setClaimsEnabled] = useState(true)
  const [claimable, setClaimable] = useState<GenOwlRevShareClaimableRow[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!connected || needsSignIn) {
      setClaimable([])
      setClaimsEnabled(true)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/me/nesting/gen-owl-rev-share/claimable', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load rev share claims.')
        setClaimable([])
        return
      }
      setClaimsEnabled(data.claims_enabled !== false)
      setClaimable(Array.isArray(data.claimable) ? data.claimable : [])
    } catch {
      setError('Network error loading rev share.')
      setClaimable([])
    } finally {
      setLoading(false)
    }
  }, [connected, needsSignIn])

  useEffect(() => {
    void load()
  }, [load])

  const claimAllCount = claimable.length
  const monthGroups = useMemo(() => groupByMonth(claimable), [claimable])
  const totals = useMemo(() => {
    let sol = 0
    let usdc = 0
    for (const row of claimable) {
      sol += row.amount_sol
      usdc += row.amount_usdc
    }
    return { sol, usdc }
  }, [claimable])

  const claimAll = async () => {
    if (claimable.length === 0) return
    setBusy(true)
    setError(null)
    setMessage(null)
    let claimedSol = 0
    let claimedUsdc = 0
    let claimedCount = 0
    for (const row of claimable) {
      try {
        const res = await fetch('/api/me/nesting/gen-owl-rev-share/claim', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ period_month: row.period_month, position_id: row.position_id }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof data.error === 'string' ? data.error : 'Claim failed.')
          break
        }
        claimedSol += Number(data.amount_sol) || 0
        claimedUsdc += Number(data.amount_usdc) || 0
        claimedCount += 1
      } catch {
        setError('Network error during claim.')
        break
      }
    }
    if (claimedCount > 0) {
      const parts: string[] = []
      if (claimedSol > 0) parts.push(`${formatGenOwlRevShareSol(claimedSol)} SOL`)
      if (claimedUsdc > 0) parts.push(`${formatGenOwlRevShareUsdc(claimedUsdc)} USDC`)
      setMessage(
        `Rev share sent${claimedCount > 1 ? ` for ${claimedCount} nests` : ''}: ${parts.join(' · ')}`
      )
    }
    setBusy(false)
    await load()
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-3 sm:px-4 sm:py-4',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Monthly rev share</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        {GEN_OWL_REV_SHARE_SHORT_BLURB} {genOwlRevShareDistributionSummary('gen1-owl')}{' '}
        {genOwlRevShareDistributionSummary('gen2-owl')}
      </p>

      {!connected ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Connect your wallet in the header, then open Claims on My nest to view and claim SOL/USDC.
          </p>
          <Button asChild variant="outline" className="min-h-[44px] w-full touch-manipulation sm:w-auto">
            <Link href="/dashboard/nesting#nesting-claims">Open Claims</Link>
          </Button>
        </div>
      ) : needsSignIn ? (
        <p className="mt-2 text-xs text-amber-400/95">Sign in with your wallet to view and claim rev share.</p>
      ) : loading ? (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Checking claimable rev share…
        </p>
      ) : !claimsEnabled ? (
        <p className="mt-2 text-xs text-amber-400/95">
          Claims are temporarily paused. Your rev share stays stacked — check back soon.
        </p>
      ) : claimable.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing to claim right now. When a month opens, unclaimed Gen 1 / Gen 2 rev share stays stacked here until
          you claim.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-foreground/90">
            Ready to claim
            {monthGroups.length > 1 ? ` across ${monthGroups.length} months` : ''}
            :{' '}
            {totals.sol > 0 ? (
              <span className="font-semibold tabular-nums text-theme-prime">
                {formatGenOwlRevShareSol(totals.sol)} SOL
              </span>
            ) : null}
            {totals.sol > 0 && totals.usdc > 0 ? ' · ' : null}
            {totals.usdc > 0 ? (
              <span className="font-semibold tabular-nums text-theme-prime">
                {formatGenOwlRevShareUsdc(totals.usdc)} USDC
              </span>
            ) : null}{' '}
            from {claimAllCount} nest{claimAllCount === 1 ? '' : 's'}.
          </p>
          {monthGroups.length > 1 ? (
            <ul className="space-y-1.5">
              {monthGroups.map((g) => (
                <li
                  key={g.period_month}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/15 px-2.5 py-2 text-xs"
                >
                  <span className="min-w-0 text-muted-foreground">
                    {g.period_label}
                    <span className="text-muted-foreground/80">
                      {' '}
                      · {g.nest_count} nest{g.nest_count === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-theme-prime/95">
                    {g.amount_sol > 0 ? `${formatGenOwlRevShareSol(g.amount_sol)} SOL` : null}
                    {g.amount_sol > 0 && g.amount_usdc > 0 ? ' · ' : null}
                    {g.amount_usdc > 0 ? `${formatGenOwlRevShareUsdc(g.amount_usdc)} USDC` : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            type="button"
            className={cn(nestingClaimReadyButtonClass, 'min-h-[48px] w-full touch-manipulation text-base')}
            disabled={busy}
            onClick={() => void claimAll()}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden />
                Claiming…
              </>
            ) : (
              <>
                Claim
                {totals.sol > 0 ? ` ${formatGenOwlRevShareSol(totals.sol)} SOL` : ''}
                {totals.sol > 0 && totals.usdc > 0 ? ' ·' : ''}
                {totals.usdc > 0 ? ` ${formatGenOwlRevShareUsdc(totals.usdc)} USDC` : ''}
              </>
            )}
          </Button>
        </div>
      )}

      {message ? <p className="mt-2 text-xs text-emerald-400/95">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-amber-400/95">{error}</p> : null}
    </div>
  )
}
