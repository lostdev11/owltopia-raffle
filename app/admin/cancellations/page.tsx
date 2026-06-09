'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, BarChart3, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin } from '@/lib/admin-check-cache'

type CancellationRow = {
  id: string
  slug: string
  title: string
  status: string | null
  creator_wallet: string | null
  cancellation_requested_at: string | null
  cancellation_fee_paid_at: string | null
  cancelled_at: string | null
  cancellation_refund_policy: 'full_refund' | 'no_refund' | null
  cancellation_fee_amount: number | null
  cancellation_fee_currency: string | null
}

type CancellationStats = {
  pendingCount: number
  acceptedCount: number
  hostedRaffles: number
  completedRaffles: number
  cancellationRatePercent: number
}

type CancellationsPayload = {
  pending: CancellationRow[]
  accepted: CancellationRow[]
  stats: CancellationStats
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function feeLabel(row: CancellationRow): string {
  if (row.cancellation_fee_paid_at) {
    if (row.cancellation_fee_amount != null && row.cancellation_fee_currency) {
      return `Paid ${row.cancellation_fee_amount} ${row.cancellation_fee_currency}`
    }
    return 'Paid'
  }
  return 'Not paid'
}

function refundPolicyLabel(policy: CancellationRow['cancellation_refund_policy']): string {
  if (policy === 'no_refund') return 'Host fee retained'
  if (policy === 'full_refund') return 'No host fee'
  return '—'
}

function shortWallet(wallet: string | null): string {
  if (!wallet) return '—'
  if (wallet.length <= 12) return wallet
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
}

export default function AdminCancellationsPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loadingAuth, setLoadingAuth] = useState(() => !cachedTrue)
  const [loadingData, setLoadingData] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CancellationsPayload | null>(null)

  const fetchCancellations = useCallback(async () => {
    setLoadingData(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/cancellations', { credentials: 'include', cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          typeof body?.error === 'string' ? body.error : 'Could not load cancellation queue'
        )
      }
      const json = (await res.json()) as CancellationsPayload
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load cancellation queue')
      setData(null)
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoadingAuth(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached === true) {
      setIsAdmin(true)
      setLoadingAuth(false)
      void fetchCancellations()
      return
    }
    if (cached === false) {
      setIsAdmin(false)
      setLoadingAuth(false)
      return
    }
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`)
      .then((r) => r.json())
      .then((body: { isAdmin?: boolean }) => {
        if (body?.isAdmin) {
          setIsAdmin(true)
          void fetchCancellations()
        } else {
          setIsAdmin(false)
        }
      })
      .catch(() => setIsAdmin(false))
      .finally(() => setLoadingAuth(false))
  }, [connected, publicKey, fetchCancellations])

  if (!connected) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <p className="mb-4">Connect your wallet to access the cancellation queue.</p>
        <WalletConnectButton />
      </main>
    )
  }

  if (loadingAuth) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking admin access...
        </p>
      </main>
    )
  }

  if (isAdmin === false) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <p className="mb-4">Admin access required to view the cancellation queue.</p>
        <Button asChild variant="outline" className="min-h-11 touch-manipulation">
          <Link href="/admin">Back to Owl Vision</Link>
        </Button>
      </main>
    )
  }

  const stats = data?.stats

  return (
    <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-5xl">
      <div className="mb-6 sm:mb-8">
        <Button asChild variant="outline" size="sm" className="mb-4 min-h-11 touch-manipulation">
          <Link href="/admin">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Owl Vision
          </Link>
        </Button>
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 flex items-center gap-2">
          <BarChart3 className="h-7 w-7 shrink-0" />
          Cancellation queue
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Review pending creator cancellation requests, see accepted history, and track platform cancellation rate.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 touch-manipulation"
          disabled={loadingData}
          onClick={() => void fetchCancellations()}
        >
          {loadingData ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Refreshing...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </>
          )}
        </Button>
        <Button asChild variant="outline" className="min-h-11 touch-manipulation">
          <Link href="/admin/raffles?queue=pending-cancellation#pending-cancellation">
            Manage raffles view
          </Link>
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive mb-6">{error}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cancellation rate</CardDescription>
            <CardTitle className="text-2xl">
              {loadingData || !stats ? '…' : `${stats.cancellationRatePercent}%`}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {loadingData || !stats
              ? 'Loading platform stats...'
              : `${stats.acceptedCount} accepted of ${stats.hostedRaffles} hosted raffles`}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending review</CardDescription>
            <CardTitle className="text-2xl">
              {loadingData || !stats ? '…' : stats.pendingCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Awaiting admin accept in Owl Vision
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Accepted (shown)</CardDescription>
            <CardTitle className="text-2xl">
              {loadingData || !stats ? '…' : stats.acceptedCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Creator-requested cancellations admin accepted
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Completed raffles</CardDescription>
            <CardTitle className="text-2xl">
              {loadingData || !stats ? '…' : stats.completedRaffles}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            For context alongside cancellations
          </CardContent>
        </Card>
      </div>

      <section className="mb-10">
        <h2 className="text-lg sm:text-xl font-semibold mb-2">Pending cancellation requests</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Open each raffle in Owl Vision to accept cancellation and process refunds.
        </p>
        {loadingData ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading pending requests...
          </p>
        ) : !data?.pending.length ? (
          <p className="text-sm text-muted-foreground">No pending cancellation requests right now.</p>
        ) : (
          <CancellationTable rows={data.pending} mode="pending" />
        )}
      </section>

      <section>
        <h2 className="text-lg sm:text-xl font-semibold mb-2">Accepted cancellations</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Past creator requests that admins accepted. Most recent first (up to 200).
        </p>
        {loadingData ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading accepted history...
          </p>
        ) : !data?.accepted.length ? (
          <p className="text-sm text-muted-foreground">No accepted creator cancellations yet.</p>
        ) : (
          <CancellationTable rows={data.accepted} mode="accepted" />
        )}
      </section>
    </main>
  )
}

function CancellationTable({
  rows,
  mode,
}: {
  rows: CancellationRow[]
  mode: 'pending' | 'accepted'
}) {
  return (
    <div className="rounded-md border overflow-x-auto max-h-[min(70vh,560px)] overflow-y-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 sticky top-0 z-[1] shadow-[0_1px_0_hsl(var(--border))]">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Raffle</th>
            <th className="px-3 py-2 font-medium">Creator</th>
            <th className="px-3 py-2 font-medium">Requested</th>
            {mode === 'accepted' ? (
              <th className="px-3 py-2 font-medium">Accepted</th>
            ) : (
              <th className="px-3 py-2 font-medium">Listing status</th>
            )}
            <th className="px-3 py-2 font-medium">Fee</th>
            {mode === 'accepted' ? <th className="px-3 py-2 font-medium">Refund policy</th> : null}
            <th className="px-3 py-2 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="px-3 py-2">
                <div className="font-medium">{row.title}</div>
                <div className="text-xs text-muted-foreground">/{row.slug}</div>
                {mode === 'pending' ? (
                  <div className="mt-1">
                    <span className="inline-flex rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Cancellation pending admin
                    </span>
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2 text-muted-foreground font-mono text-xs">
                {shortWallet(row.creator_wallet)}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.cancellation_requested_at
                  ? formatWhen(row.cancellation_requested_at)
                  : row.cancellation_fee_paid_at
                    ? `Fee paid ${formatWhen(row.cancellation_fee_paid_at)}`
                    : '—'}
              </td>
              {mode === 'accepted' ? (
                <td className="px-3 py-2 text-muted-foreground">{formatWhen(row.cancelled_at)}</td>
              ) : (
                <td className="px-3 py-2 text-muted-foreground">{row.status || '—'}</td>
              )}
              <td className="px-3 py-2">
                {row.cancellation_fee_paid_at ? (
                  <span className="text-emerald-600 dark:text-emerald-400">{feeLabel(row)}</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">Pending</span>
                )}
              </td>
              {mode === 'accepted' ? (
                <td className="px-3 py-2 text-muted-foreground">{refundPolicyLabel(row.cancellation_refund_policy)}</td>
              ) : null}
              <td className="px-3 py-2 text-right">
                <Button asChild size="sm" variant="outline" className="touch-manipulation min-h-[44px]">
                  <Link href={`/admin/raffles/${row.id}`}>
                    {mode === 'pending' ? 'Review' : 'View'}
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
