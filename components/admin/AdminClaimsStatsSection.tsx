'use client'

import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Loader2, AlertTriangle, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionHeader } from '@/components/council/SectionHeader'
import type { ClaimsStatsPayload } from '@/lib/admin/claims-stats'

function fmtSol(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
function fmtUsdc(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}
function fmtHours(n: number | null) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 24) return `${n.toFixed(1)}h`
  return `${(n / 24).toFixed(1)}d`
}
function shortWallet(w: string) {
  if (w.length < 10) return w
  return `${w.slice(0, 4)}…${w.slice(-4)}`
}

type Props = {
  enabled: boolean
}

export function AdminClaimsStatsSection({ enabled }: Props) {
  const [data, setData] = useState<ClaimsStatsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engagementOpen, setEngagementOpen] = useState(false)

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/claims-stats', {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as ClaimsStatsPayload & { error?: string }
      if (!res.ok) {
        setData(null)
        setError(typeof json.error === 'string' ? json.error : 'Failed to load claims stats')
        return
      }
      setData(json)
    } catch {
      setData(null)
      setError('Network error while loading claims stats.')
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void load()
  }, [load])

  if (!enabled) return null

  return (
    <section id="claims-stats" className="space-y-4 scroll-mt-24">
      <SectionHeader
        title="Claims analytics"
        description="Gen Owl rev-share claim rates, unclaimed liability, partial payout risk, and OWL nest reward volumes."
      />

      <Card className="rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 shrink-0" />
            This month pulse
            {data && (
              <span
                className={`ml-auto text-xs font-normal rounded-md px-2 py-1 ${
                  data.claimsEnabled
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'bg-destructive/15 text-destructive'
                }`}
              >
                {data.claimsEnabled ? 'Claims open' : 'Claims paused'}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            {data?.pulse.periodMonth ? `Period ${data.pulse.periodMonth}` : 'Latest period with data'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && !data ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 touch-manipulation"
                onClick={() => void load()}
              >
                Retry
              </Button>
            </div>
          ) : loading || !data ? (
            <p className="text-muted-foreground flex items-center gap-2 min-h-[44px]">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              Loading claims stats…
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Claim rate</p>
                  <p className="text-lg font-semibold tabular-nums">{fmtPct(data.pulse.claimRate)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Paid</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {fmtSol(data.pulse.paidSol)} SOL
                  </p>
                  <p className="text-sm font-semibold tabular-nums">
                    {fmtUsdc(data.pulse.paidUsdc)} USDC
                  </p>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 col-span-2 sm:col-span-1">
                  <p className="text-xs text-muted-foreground">Unclaimed liability</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {fmtSol(data.pulse.liabilitySol)} SOL
                  </p>
                  <p className="text-sm font-semibold tabular-nums">
                    {fmtUsdc(data.pulse.liabilityUsdc)} USDC
                  </p>
                </div>
              </div>

              {/* Period table */}
              <div>
                <h3 className="text-sm font-medium mb-2">By period</h3>
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full text-xs min-w-[640px]">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="py-2 pr-2 font-medium">Month</th>
                        <th className="py-2 pr-2 font-medium">Rate</th>
                        <th className="py-2 pr-2 font-medium">Claimed</th>
                        <th className="py-2 pr-2 font-medium">Paid SOL/USDC</th>
                        <th className="py-2 pr-2 font-medium">Liability</th>
                        <th className="py-2 pr-2 font-medium">Median / p90</th>
                        <th className="py-2 font-medium">Partial</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.periods.map((p) => (
                        <tr key={p.periodMonth} className="border-b border-border/50">
                          <td className="py-2 pr-2 font-mono">{p.periodMonth}</td>
                          <td className="py-2 pr-2 tabular-nums">{fmtPct(p.claimRate)}</td>
                          <td className="py-2 pr-2 tabular-nums">
                            {p.claimedTotal}/{p.eligibleTotal || '—'}
                            <span className="text-muted-foreground">
                              {' '}
                              (G1 {p.claimedGen1}/G2 {p.claimedGen2})
                            </span>
                          </td>
                          <td className="py-2 pr-2 tabular-nums">
                            {fmtSol(p.paidSol)} / {fmtUsdc(p.paidUsdc)}
                          </td>
                          <td className="py-2 pr-2 tabular-nums">
                            {fmtSol(p.liabilitySol)} / {fmtUsdc(p.liabilityUsdc)}
                          </td>
                          <td className="py-2 pr-2 tabular-nums">
                            {fmtHours(p.medianHoursToClaim)} / {fmtHours(p.p90HoursToClaim)}
                          </td>
                          <td className="py-2 tabular-nums">{p.partialCount || '—'}</td>
                        </tr>
                      ))}
                      {data.periods.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-4 text-muted-foreground">
                            No rev-share periods yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Risk */}
              {data.risk.partialClaims.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Partial payouts ({data.risk.partialClaims.length})
                  </p>
                  <ul className="space-y-1 text-xs font-mono">
                    {data.risk.partialClaims.slice(0, 10).map((c) => (
                      <li key={c.id}>
                        {c.periodMonth} · {shortWallet(c.walletAddress)} ·{' '}
                        {c.hasSolSig ? 'SOL✓' : 'SOL✗'} {c.hasUsdcSig ? 'USDC✓' : 'USDC✗'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* OWL strip */}
              <div>
                <h3 className="text-sm font-medium mb-2">OWL nest rewards</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">24h claimed</p>
                    <p className="font-semibold tabular-nums">
                      {data.owl.claimVolume24h.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">{data.owl.claimVolume24h.count} txs</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">7d claimed</p>
                    <p className="font-semibold tabular-nums">
                      {data.owl.claimVolume7d.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">{data.owl.claimVolume7d.count} txs</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">30d claimed</p>
                    <p className="font-semibold tabular-nums">
                      {data.owl.claimVolume30d.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">{data.owl.claimVolume30d.count} txs</p>
                  </div>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-xs text-muted-foreground">Claimable overhang</p>
                    <p className="font-semibold tabular-nums">
                      {data.owl.claimableOverhang.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {data.owl.activeOwlNests} active nests
                    </p>
                  </div>
                </div>
                {(data.owl.onchainShare != null || data.owl.dbOnlyShare != null) && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Path mix (30d): {fmtPct(data.owl.onchainShare)} on-chain · {fmtPct(data.owl.dbOnlyShare)}{' '}
                    DB-only
                  </p>
                )}
              </div>

              {/* Engagement (collapsed) */}
              <div>
                <button
                  type="button"
                  className="flex w-full items-center justify-between min-h-11 touch-manipulation text-sm font-medium"
                  onClick={() => setEngagementOpen((o) => !o)}
                  aria-expanded={engagementOpen}
                >
                  Engagement
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${engagementOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {engagementOpen && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2 text-sm">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Avg unclaimed months / wallet</p>
                      <p className="font-semibold tabular-nums">
                        {data.engagement.avgUnclaimedMonthsPerWallet != null
                          ? data.engagement.avgUnclaimedMonthsPerWallet.toFixed(1)
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Top 10 wallets share of paid</p>
                      <p className="font-semibold tabular-nums">
                        {fmtPct(data.engagement.top10WalletSharePaid)}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Claimed within 48h</p>
                      <p className="font-semibold tabular-nums">
                        {fmtPct(data.engagement.claimWithin48hRate)}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                className="min-h-11 touch-manipulation"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Refresh
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
