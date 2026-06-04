'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Clock, Coins, Landmark, Loader2, Radio, Wallet } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatHostingCurrencyTotals } from './helpers'

type RaffleStub = {
  id: string
  slug: string
  title: string
  creator_payout_amount?: number | null
  currency?: string
}

function MetricPill({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/70 p-3 min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums break-words sm:text-lg">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{hint}</p> : null}
    </div>
  )
}

function HostingCallout({
  tone,
  title,
  children,
}: {
  tone: 'amber' | 'emerald' | 'neutral'
  title: string
  children: ReactNode
}) {
  const border =
    tone === 'amber'
      ? 'border-amber-500/40 bg-amber-500/[0.07]'
      : tone === 'emerald'
        ? 'border-emerald-500/40 bg-emerald-500/[0.09]'
        : 'border-border/60 bg-muted/20'
  const Icon = tone === 'amber' ? AlertTriangle : tone === 'emerald' ? Coins : Clock
  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${border}`} role={tone === 'amber' ? 'status' : undefined}>
      <p className="flex items-start gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 shrink-0 mt-0.5 opacity-80" aria-hidden />
        <span>{title}</span>
      </p>
      <div className="mt-2 pl-6 text-xs text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </div>
  )
}

export function HostingClaimTracker({
  pollIntervalMs,
  readyNet,
  readyFee,
  readyGross,
  liveSales,
  pendingClaims,
  awaitingSettlement,
  liveEscrowCount,
  endedAwaitingDraw,
  hasLiveEscrowSales,
  claimProceedsLoadingId,
  onClaimProceeds,
  onGoOverview,
}: {
  pollIntervalMs: number
  readyNet: Record<string, number>
  readyFee: Record<string, number>
  readyGross: Record<string, number>
  liveSales: { net: Record<string, number>; fee: Record<string, number>; gross: Record<string, number> }
  pendingClaims: RaffleStub[]
  awaitingSettlement: RaffleStub[]
  liveEscrowCount: number
  endedAwaitingDraw: RaffleStub[]
  hasLiveEscrowSales: boolean
  claimProceedsLoadingId: string | null
  onClaimProceeds: (raffleId: string) => void
  onGoOverview: () => void
}) {
  const showEmpty =
    pendingClaims.length === 0 &&
    awaitingSettlement.length === 0 &&
    liveEscrowCount === 0 &&
    !hasLiveEscrowSales

  return (
    <Card className="rounded-xl border-emerald-500/30 bg-gradient-to-b from-emerald-500/[0.08] to-transparent shadow-sm">
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2.5 text-base sm:text-lg">
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
                <Radio className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
              </span>
              Live claim tracker
            </CardTitle>
            <CardDescription>
              Refreshes about every {Math.round(pollIntervalMs / 1000)}s on this tab, or when you use refresh in the
              header.
            </CardDescription>
          </div>
          <details className="rounded-lg border border-border/50 bg-background/60 text-sm sm:max-w-xs">
            <summary className="cursor-pointer px-3 py-2.5 font-medium touch-manipulation min-h-[44px] flex items-center">
              Escrow tips
            </summary>
            <p className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
              Overview tab revenue uses the same refresh. On mobile, stable Wi‑Fi or mobile data helps if totals lag.
            </p>
          </details>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2 rounded-xl border border-emerald-500/25 bg-background/50 p-3 sm:p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Ready after draw
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {pendingClaims.length} settled raffle{pendingClaims.length === 1 ? '' : 's'} — claim sends net to you and
              fee to treasury in one tx.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <MetricPill label="Net to you" value={formatHostingCurrencyTotals(readyNet)} />
              <MetricPill label="Platform fee" value={formatHostingCurrencyTotals(readyFee)} hint="Same claim tx" />
              <MetricPill label="Gross" value={formatHostingCurrencyTotals(readyGross)} hint="Net + fee" />
            </div>
          </section>
          <section className="space-y-2 rounded-xl border border-border/60 bg-background/50 p-3 sm:p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">While still live</p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Confirmed ticket sales on funds-escrow raffles before the draw ({liveEscrowCount} listing
              {liveEscrowCount === 1 ? '' : 's'}).
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <MetricPill label="Net in escrow" value={formatHostingCurrencyTotals(liveSales.net)} />
              <MetricPill label="Fee in escrow" value={formatHostingCurrencyTotals(liveSales.fee)} />
              <MetricPill label="Gross in escrow" value={formatHostingCurrencyTotals(liveSales.gross)} />
            </div>
          </section>
        </div>

        {pendingClaims.length > 0 && (
          <HostingCallout tone="emerald" title="Claim now — ticket proceeds">
            <p>One transaction per raffle. You can also claim from each row under My raffles.</p>
            <ul className="space-y-2 !text-sm">
              {pendingClaims.map((r) => {
                const payout =
                  r.creator_payout_amount != null && r.currency
                    ? `${Number(r.creator_payout_amount).toFixed(r.currency === 'USDC' ? 2 : 4)} ${r.currency} net`
                    : null
                return (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <Link href={`/raffles/${r.slug}`} className="font-medium text-foreground hover:underline truncate block">
                        {r.title}
                      </Link>
                      {payout ? <p className="mt-0.5 tabular-nums text-foreground/90">{payout}</p> : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="touch-manipulation min-h-[44px] w-full shrink-0 sm:w-auto"
                      disabled={claimProceedsLoadingId === r.id}
                      onClick={() => onClaimProceeds(r.id)}
                    >
                      {claimProceedsLoadingId === r.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden />
                          Claiming…
                        </>
                      ) : (
                        <>
                          <Wallet className="h-4 w-4 mr-2" aria-hidden />
                          Claim funds
                        </>
                      )}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </HostingCallout>
        )}

        {awaitingSettlement.length > 0 && (
          <HostingCallout tone="neutral" title={`Waiting for settlement (${awaitingSettlement.length})`}>
            <p>Winner recorded; payout lines are being finalized. Amounts move to “ready after draw” when done.</p>
            <ul className="space-y-1.5 !text-sm">
              {awaitingSettlement.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <Link href={`/raffles/${r.slug}`} className="text-primary font-medium hover:underline">
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
            {awaitingSettlement.length > 8 && (
              <p className="!mt-2">+{awaitingSettlement.length - 8} more in My raffles</p>
            )}
          </HostingCallout>
        )}

        {liveEscrowCount > 0 && (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-3 sm:p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              Ticket sales still in escrow ({liveEscrowCount})
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              Proceeds stay in escrow until the draw. After settlement, totals appear in “ready after draw.” Headline
              revenue on{' '}
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline touch-manipulation"
                onClick={onGoOverview}
              >
                Overview
              </button>{' '}
              updates as purchases confirm.
            </p>
          </div>
        )}

        {endedAwaitingDraw.length > 0 && (
          <HostingCallout tone="amber" title="End time passed — draw still pending">
            <p>
              Claim unlocks <span className="font-medium text-foreground">after</span> a winner is chosen. Open each
              raffle once to run the draw, or wait for the automatic job (~15 min).
            </p>
            <ul className="space-y-1.5 !text-sm">
              {endedAwaitingDraw.slice(0, 10).map((r) => (
                <li key={r.id}>
                  <Link href={`/raffles/${r.slug}`} className="text-primary font-medium hover:underline">
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
            {endedAwaitingDraw.length > 10 && (
              <p className="!mt-2">+{endedAwaitingDraw.length - 10} more in My raffles</p>
            )}
          </HostingCallout>
        )}

        {showEmpty && (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border/60 p-4 text-center">
            No active escrow pipeline. When you host funds-escrow raffles, live sales show under “while still live”; after
            a draw, claim totals appear above.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
