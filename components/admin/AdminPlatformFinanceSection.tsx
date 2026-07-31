'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DollarSign, Loader2, Coins, Ticket, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardDescription } from '@/components/ui/card'
import { OwlVisionDisclosure } from '@/components/OwlVisionDisclosure'
import type { CurrencyBucket, PlatformFinancePayload } from '@/lib/admin/platform-finance'

function fmtSol(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
function fmtUsdc(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtOwl(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function CurrencyLine({ b }: { b: CurrencyBucket }) {
  return (
    <p className="tabular-nums text-sm">
      <span className="font-semibold">{fmtSol(b.sol)}</span> SOL
      {' · '}
      <span className="font-semibold">{fmtUsdc(b.usdc)}</span> USDC
      {b.owl > 0 ? (
        <>
          {' · '}
          <span className="font-semibold">{fmtOwl(b.owl)}</span> OWL
        </>
      ) : null}
    </p>
  )
}

type Props = {
  wallet: string | null
  refreshTick?: number
}

export function AdminPlatformFinanceSection({ wallet, refreshTick = 0 }: Props) {
  const [data, setData] = useState<PlatformFinancePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!wallet) {
      setData(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/platform-finance?wallet=${encodeURIComponent(wallet)}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as PlatformFinancePayload & { error?: string }
      if (!res.ok) {
        setData(null)
        setError(typeof json.error === 'string' ? json.error : 'Failed to load platform finance')
        return
      }
      setData(json)
    } catch {
      setData(null)
      setError('Network error while loading platform finance.')
    } finally {
      setLoading(false)
    }
  }, [wallet])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  return (
    <OwlVisionDisclosure
      className="mb-8"
      variant="default"
      title={
        <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <DollarSign className="h-5 w-5 shrink-0" />
          Platform Finance
        </span>
      }
    >
      <CardDescription className="mb-4">
        Real treasury inflows: raffle/auction fees collected when creators claim proceeds, cancellation fees, and Gen
        Owl rev-share deposits vs payouts. Ticket totals are volume only — not platform revenue.
      </CardDescription>

      {error && !data ? (
        <div className="space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 touch-manipulation"
            onClick={() => void load()}
          >
            Retry
          </Button>
        </div>
      ) : loading || !data ? (
        <p className="text-muted-foreground flex items-center gap-2 min-h-[44px]">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Loading platform finance…
        </p>
      ) : (
        <div className="space-y-6">
          {/* Raffle settlement fees */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-1">Raffle settlement fees</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Fee is accrued at draw settlement and collected when the creator claims proceeds (same tx as net payout).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Collected (in treasury)</p>
                <CurrencyLine b={data.raffleSettlementFees.collected} />
                <p className="text-xs text-muted-foreground">
                  {data.raffleSettlementFees.collected.count} raffle
                  {data.raffleSettlementFees.collected.count === 1 ? '' : 's'}
                  {data.raffleSettlementFees.medianDaysToClaim != null
                    ? ` · median ${data.raffleSettlementFees.medianDaysToClaim.toFixed(1)}d to claim`
                    : ''}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Collected last 30d</p>
                <CurrencyLine b={data.raffleSettlementFees.collected30d} />
                <p className="text-xs text-muted-foreground">
                  {data.raffleSettlementFees.collected30d.count} raffle
                  {data.raffleSettlementFees.collected30d.count === 1 ? '' : 's'}
                </p>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Pending in escrow
                </p>
                <CurrencyLine b={data.raffleSettlementFees.pendingEscrow} />
                <p className="text-xs text-muted-foreground">
                  {data.raffleSettlementFees.pendingEscrow.count} settled, creator not claimed yet
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Accrued (settled snapshot)</p>
                <CurrencyLine b={data.raffleSettlementFees.accrued} />
                <p className="text-xs text-muted-foreground">
                  {data.raffleSettlementFees.accrued.count} raffle
                  {data.raffleSettlementFees.accrued.count === 1 ? '' : 's'} with fee amounts
                </p>
              </div>
            </div>
          </div>

          {/* Auctions + cancellation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(data.auctionSettlementFees.accrued.count > 0 ||
              data.auctionSettlementFees.collected.count > 0) && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">Auction settlement fees</h3>
                <div className="rounded-lg border p-4 space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Collected: </span>
                    <CurrencyLine b={data.auctionSettlementFees.collected} />
                  </div>
                  <div>
                    <span className="text-muted-foreground">Pending: </span>
                    <CurrencyLine b={data.auctionSettlementFees.pendingEscrow} />
                  </div>
                </div>
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">Cancellation fees</h3>
              <div className="rounded-lg border p-4 space-y-1">
                <CurrencyLine b={data.cancellationFees} />
                <p className="text-xs text-muted-foreground">
                  {data.cancellationFees.count} paid cancellation
                  {data.cancellationFees.count === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          </div>

          {/* Rev share cashflow */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <Coins className="h-4 w-4" />
                Gen Owl rev share
              </h3>
              <span
                className={`text-xs rounded-md px-2 py-1 min-h-[28px] inline-flex items-center ${
                  data.revShare.claimsEnabled
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'bg-destructive/15 text-destructive'
                }`}
              >
                Claims {data.revShare.claimsEnabled ? 'open' : 'paused'}
              </span>
              <Link
                href="/admin/nesting#claims-stats"
                className="text-xs text-primary underline-offset-2 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
              >
                Claims analytics →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
                <p className="text-xs text-muted-foreground">Deposited</p>
                <p className="tabular-nums text-sm">
                  <span className="font-semibold">{fmtSol(data.revShare.deposited.sol)}</span> SOL ·{' '}
                  <span className="font-semibold">{fmtUsdc(data.revShare.deposited.usdc)}</span> USDC
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
                <p className="text-xs text-muted-foreground">Paid to nests</p>
                <p className="tabular-nums text-sm">
                  <span className="font-semibold">{fmtSol(data.revShare.paid.sol)}</span> SOL ·{' '}
                  <span className="font-semibold">{fmtUsdc(data.revShare.paid.usdc)}</span> USDC
                </p>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-1">
                <p className="text-xs text-muted-foreground">Unclaimed liability</p>
                <p className="tabular-nums text-sm">
                  <span className="font-semibold">{fmtSol(data.revShare.unclaimedLiability.sol)}</span> SOL ·{' '}
                  <span className="font-semibold">{fmtUsdc(data.revShare.unclaimedLiability.usdc)}</span> USDC
                </p>
              </div>
            </div>
            {data.revShare.periods.length > 0 && (
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-xs min-w-[480px]">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-2 font-medium">Period</th>
                      <th className="py-2 pr-2 font-medium">Deposited</th>
                      <th className="py-2 pr-2 font-medium">Paid</th>
                      <th className="py-2 font-medium">Liability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.revShare.periods.slice(0, 8).map((p) => (
                      <tr key={p.periodMonth} className="border-b border-border/50">
                        <td className="py-2 pr-2 font-mono">{p.periodMonth}</td>
                        <td className="py-2 pr-2 tabular-nums">
                          {fmtSol(p.depositedSol)} / {fmtUsdc(p.depositedUsdc)}
                        </td>
                        <td className="py-2 pr-2 tabular-nums">
                          {fmtSol(p.paidSol)} / {fmtUsdc(p.paidUsdc)}
                        </td>
                        <td className="py-2 tabular-nums">
                          {fmtSol(p.liabilitySol)} / {fmtUsdc(p.liabilityUsdc)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Ticket activity */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-1 flex items-center gap-2">
              <Ticket className="h-4 w-4" />
              Ticket volume (not revenue)
            </h3>
            <p className="text-xs text-muted-foreground mb-3">Confirmed entry GMV — mostly creator proceeds.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { label: 'Last 7 days', b: data.ticketActivity.last7Days },
                { label: 'Last 30 days', b: data.ticketActivity.last30Days },
              ].map(({ label, b }) => (
                <div key={label} className="rounded-lg border p-4 space-y-2 text-sm">
                  <p className="font-medium">{label}</p>
                  <CurrencyLine b={b} />
                  <p className="text-xs text-muted-foreground">
                    {b.ticketsSold.toLocaleString()} tickets · {b.confirmedEntries.toLocaleString()} entries
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </OwlVisionDisclosure>
  )
}
