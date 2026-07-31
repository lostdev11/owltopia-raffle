'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { CheckCircle2, Coins, ExternalLink, Loader2 } from 'lucide-react'

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
import {
  formatPeriodMonthLabel,
  latestOpenClaimPeriodMonth,
} from '@/lib/nesting/gen-owl-rev-share-month'
import { sendStakingPlatformFeeTransaction } from '@/lib/nesting/client/staking-platform-fee-tx'
import type { StakingPlatformFeeTxConfig } from '@/lib/nesting/client/staking-platform-fee-tx'
import {
  formatStakingPlatformFeeTotalLabel,
  getStakingPlatformFeeLamports,
  getStakingPlatformFeeSol,
  isStakingPlatformFeeEnabledClient,
} from '@/lib/nesting/staking-platform-fee'
import { nestingClaimReadyButtonClass } from '@/lib/nesting/ui-classes'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
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

type ClaimSuccessState = {
  amount_sol: number
  amount_usdc: number
  claim_count: number
  fee_signature: string | null
  sol_transaction_signature: string | null
  usdc_transaction_signature: string | null
}

function solscanTxUrl(signature: string): string {
  const sig = signature.trim()
  if (!sig) return ''
  const cluster = /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${encodeURIComponent(sig)}${cluster}`
}

function SolscanTxLink({
  signature,
  label,
}: {
  signature: string | null | undefined
  label: string
}) {
  const sig = signature?.trim()
  if (!sig) return null
  const href = solscanTxUrl(sig)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[44px] items-center gap-1 touch-manipulation text-xs font-medium text-theme-prime underline-offset-4 hover:underline"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </a>
  )
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
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const [loading, setLoading] = useState(false)
  const [claimsEnabled, setClaimsEnabled] = useState(true)
  const [claimable, setClaimable] = useState<GenOwlRevShareClaimableRow[]>([])
  const [history, setHistory] = useState<GenOwlRevShareClaimableRow[]>([])
  const [busy, setBusy] = useState(false)
  const [phaseHint, setPhaseHint] = useState<string | null>(null)
  const [success, setSuccess] = useState<ClaimSuccessState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feeConfig, setFeeConfig] = useState<StakingPlatformFeeTxConfig | null>(null)

  const load = useCallback(async () => {
    if (!connected || needsSignIn) {
      setClaimable([])
      setHistory([])
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
        setHistory([])
        return
      }
      setClaimsEnabled(data.claims_enabled !== false)
      setClaimable(Array.isArray(data.claimable) ? data.claimable : [])
      setHistory(Array.isArray(data.history) ? data.history : [])
    } catch {
      setError('Network error loading rev share.')
      setClaimable([])
      setHistory([])
    } finally {
      setLoading(false)
    }
  }, [connected, needsSignIn])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/staking/pools', { cache: 'no-store' })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return
        const treasury =
          typeof data.nesting_platform_fee_treasury === 'string'
            ? data.nesting_platform_fee_treasury.trim()
            : ''
        const unitLamports = Number(data.nesting_platform_fee_lamports) || 0
        if (treasury && unitLamports > 0) {
          setFeeConfig({ treasury, unitLamports })
        } else if (isStakingPlatformFeeEnabledClient()) {
          setFeeConfig({
            treasury: '',
            unitLamports: getStakingPlatformFeeLamports(),
          })
        } else {
          setFeeConfig(null)
        }
      })
      .catch(() => {
        if (!cancelled) setFeeConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const feeActive = Boolean(feeConfig && (feeConfig.unitLamports > 0 || getStakingPlatformFeeSol() > 0))
  const feeLabel = feeActive ? formatStakingPlatformFeeTotalLabel(claimAllCount) : null

  const openPeriodMonth = useMemo(() => latestOpenClaimPeriodMonth(), [])
  const claimedOpenPeriod = useMemo(() => {
    if (!openPeriodMonth) return null
    const rows = history.filter((r) => r.period_month === openPeriodMonth)
    if (rows.length === 0) return null
    const withSig =
      rows.find((r) => r.sol_transaction_signature || r.usdc_transaction_signature) ?? rows[0]!
    return {
      label: formatPeriodMonthLabel(openPeriodMonth),
      sol_signature: withSig.sol_transaction_signature ?? null,
      usdc_signature: withSig.usdc_transaction_signature ?? null,
    }
  }, [history, openPeriodMonth])

  const claimAll = async () => {
    if (claimable.length === 0 || !publicKey) return
    setBusy(true)
    setError(null)
    setPhaseHint(null)
    try {
      let platformFeeSignature: string | undefined
      if (feeActive) {
        setPhaseHint('Approve the SOL platform fee in your wallet — rev share is sent right after.')
        platformFeeSignature = await sendStakingPlatformFeeTransaction({
          connection,
          sendTransaction,
          publicKey,
          units: claimable.length,
          feeConfig,
        })
      }

      setPhaseHint('Sending rev share to your wallet…')
      const res = await fetch('/api/me/nesting/gen-owl-rev-share/claim-all', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          platformFeeSignature ? { platform_fee_signature: platformFeeSignature } : {}
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Claim failed.')
        return
      }

      setSuccess({
        amount_sol: Number(data.amount_sol) || totals.sol,
        amount_usdc: Number(data.amount_usdc) || totals.usdc,
        claim_count: Number(data.claim_count) || claimable.length,
        fee_signature: platformFeeSignature ?? null,
        sol_transaction_signature:
          typeof data.sol_transaction_signature === 'string' ? data.sol_transaction_signature : null,
        usdc_transaction_signature:
          typeof data.usdc_transaction_signature === 'string' ? data.usdc_transaction_signature : null,
      })
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error during claim.'
      setError(msg)
    } finally {
      setPhaseHint(null)
      setBusy(false)
    }
  }

  const successPayoutLinks = useMemo(() => {
    if (!success) return null
    const sol = success.sol_transaction_signature?.trim() || null
    const usdc = success.usdc_transaction_signature?.trim() || null
    if (sol && usdc && sol === usdc) {
      return <SolscanTxLink signature={sol} label="View payout on Solscan" />
    }
    return (
      <>
        <SolscanTxLink signature={sol} label="View SOL payout on Solscan" />
        <SolscanTxLink signature={usdc} label="View USDC payout on Solscan" />
      </>
    )
  }, [success])

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

      {success ? (
        <div
          className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" aria-hidden />
            <div className="min-w-0 space-y-1.5">
              <p className="text-sm font-semibold text-emerald-300">Claim successful</p>
              <p className="text-xs text-foreground/90 leading-relaxed">
                Sent{' '}
                {success.amount_sol > 0 ? (
                  <span className="font-semibold tabular-nums text-theme-prime">
                    {formatGenOwlRevShareSol(success.amount_sol)} SOL
                  </span>
                ) : null}
                {success.amount_sol > 0 && success.amount_usdc > 0 ? ' · ' : null}
                {success.amount_usdc > 0 ? (
                  <span className="font-semibold tabular-nums text-theme-prime">
                    {formatGenOwlRevShareUsdc(success.amount_usdc)} USDC
                  </span>
                ) : null}{' '}
                to your wallet
                {success.claim_count > 1 ? ` for ${success.claim_count} nests` : ''}.
              </p>
              <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                {successPayoutLinks}
                <SolscanTxLink signature={success.fee_signature} label="View fee on Solscan" />
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
        claimedOpenPeriod ? (
          <div className="mt-2 space-y-1" role="status">
            <p className="text-xs text-foreground/90 leading-relaxed">
              Claimed rev share for <span className="font-medium">{claimedOpenPeriod.label}</span>. Check back
              next month when claims open.
            </p>
            <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-3">
              {claimedOpenPeriod.sol_signature &&
              claimedOpenPeriod.usdc_signature &&
              claimedOpenPeriod.sol_signature === claimedOpenPeriod.usdc_signature ? (
                <SolscanTxLink signature={claimedOpenPeriod.sol_signature} label="View on Solscan" />
              ) : (
                <>
                  <SolscanTxLink
                    signature={claimedOpenPeriod.sol_signature}
                    label="View SOL on Solscan"
                  />
                  <SolscanTxLink
                    signature={claimedOpenPeriod.usdc_signature}
                    label="View USDC on Solscan"
                  />
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing to claim right now. When a month opens, unclaimed Gen 1 / Gen 2 rev share stays stacked here until
            you claim.
          </p>
        )
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
          {feeLabel ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Platform fee: {feeLabel}. Approve once in your wallet, then payout runs automatically.
            </p>
          ) : null}
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
          {phaseHint ? (
            <p className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
              {phaseHint}
            </p>
          ) : null}
          <Button
            type="button"
            className={cn(nestingClaimReadyButtonClass, 'min-h-[48px] w-full touch-manipulation text-base')}
            disabled={busy || !publicKey}
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
                {feeActive && claimAllCount > 0
                  ? ` · ${(getStakingPlatformFeeSol() * claimAllCount).toFixed(3)} SOL fee`
                  : ''}
              </>
            )}
          </Button>
        </div>
      )}

      {error ? <p className="mt-2 text-xs text-amber-400/95">{error}</p> : null}
    </div>
  )
}
