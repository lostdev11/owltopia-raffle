'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Coins, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  formatGenOwlRevShareSol,
  formatGenOwlRevShareUsdc,
} from '@/lib/nesting/gen-owl-rev-share'
import type { GenOwlRevShareClaimableRow } from '@/lib/nesting/gen-owl-rev-share-claimable'
import { genOwlRevShareDistributionSummary } from '@/lib/nesting/gen-owl-rev-share-copy'
import { cn } from '@/lib/utils'

type Props = {
  connected: boolean
  needsSignIn: boolean
  className?: string
}

export function GenOwlRevShareClaimPanel({ connected, needsSignIn, className }: Props) {
  const [loading, setLoading] = useState(false)
  const [claimable, setClaimable] = useState<GenOwlRevShareClaimableRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!connected || needsSignIn) {
      setClaimable([])
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
  const totals = useMemo(() => {
    let sol = 0
    let usdc = 0
    for (const row of claimable) {
      sol += row.amount_sol
      usdc += row.amount_usdc
    }
    return { sol, usdc }
  }, [claimable])

  const claimOne = async (row: GenOwlRevShareClaimableRow) => {
    setBusyId(row.position_id)
    setError(null)
    setMessage(null)
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
        return
      }
      const parts: string[] = []
      if (data.amount_sol > 0) parts.push(`${formatGenOwlRevShareSol(data.amount_sol)} SOL`)
      if (data.amount_usdc > 0) parts.push(`${formatGenOwlRevShareUsdc(data.amount_usdc)} USDC`)
      setMessage(`Rev share sent: ${parts.join(' · ')}`)
      await load()
    } catch {
      setError('Network error during claim.')
    } finally {
      setBusyId(null)
    }
  }

  const claimAll = async () => {
    setBusyId('all')
    setError(null)
    setMessage(null)
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
      } catch {
        setError('Network error during claim.')
        break
      }
    }
    setBusyId(null)
    await load()
  }

  if (!connected) return null

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
        Claim after each month ends (opens 1st of the next month, UTC).{' '}
        {genOwlRevShareDistributionSummary('gen1-owl')} Gen 2 nests split evenly at month-end.
      </p>

      {needsSignIn ? (
        <p className="mt-2 text-xs text-amber-400/95">Sign in with your wallet to view and claim rev share.</p>
      ) : loading ? (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Checking claimable rev share…
        </p>
      ) : claimable.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nothing to claim right now.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-foreground/90">
            Ready:{' '}
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
            across {claimAllCount} nest{claimAllCount === 1 ? '' : 's'}
          </p>
          <ul className="space-y-2">
            {claimable.map((row) => (
              <li
                key={`${row.period_month}-${row.position_id}`}
                className="flex flex-col gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 text-xs">
                  <p className="font-medium text-foreground">{row.period_label}</p>
                  <p className="text-muted-foreground truncate">
                    {row.group === 'gen1-owl' ? 'Gen 1 owl' : 'Gen 2 owl'}
                    {row.asset_identifier ? ` · ${row.asset_identifier.slice(0, 8)}…` : ''}
                  </p>
                  <p className="tabular-nums text-theme-prime/95">
                    {row.amount_sol > 0 ? `${formatGenOwlRevShareSol(row.amount_sol)} SOL` : null}
                    {row.amount_sol > 0 && row.amount_usdc > 0 ? ' · ' : null}
                    {row.amount_usdc > 0 ? `${formatGenOwlRevShareUsdc(row.amount_usdc)} USDC` : null}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="min-h-[44px] shrink-0 touch-manipulation"
                  disabled={busyId != null}
                  onClick={() => void claimOne(row)}
                >
                  {busyId === row.position_id ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden />
                      Claiming…
                    </>
                  ) : (
                    'Claim'
                  )}
                </Button>
              </li>
            ))}
          </ul>
          {claimAllCount > 1 ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full touch-manipulation"
              disabled={busyId != null}
              onClick={() => void claimAll()}
            >
              Claim all ({claimAllCount})
            </Button>
          ) : null}
        </div>
      )}

      {message ? <p className="mt-2 text-xs text-emerald-400/95">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-amber-400/95">{error}</p> : null}
    </div>
  )
}
