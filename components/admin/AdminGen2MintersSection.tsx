'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Download, RefreshCw } from 'lucide-react'

type MinterRow = { wallet: string; quantity: number }

type MintersPayload = {
  network: 'mainnet' | 'devnet'
  totalWallets: number
  totalMints: number
  wallets: MinterRow[]
}

type MintNetwork = 'mainnet' | 'devnet'

export function AdminGen2MintersSection() {
  const [network, setNetwork] = useState<MintNetwork>('mainnet')
  const [data, setData] = useState<MintersPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (net: MintNetwork) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/owl-center/gen2/minters?network=${net}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as MintersPayload & { error?: string }
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Could not load minters')
        setData(null)
        return
      }
      setData(json)
    } catch {
      setError('Could not load minters')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(network)
  }, [load, network])

  return (
    <div className="space-y-4">
      <CardDescription>
        Unique Gen2 minter wallets with their total minted quantity summed across all mint events. Export the full list as
        CSV (one row per wallet, <code className="text-[11px]">wallet,quantity</code>).
      </CardDescription>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(['mainnet', 'devnet'] as const).map((net) => (
            <button
              key={net}
              type="button"
              onClick={() => setNetwork(net)}
              className={`min-h-[40px] touch-manipulation rounded px-3 text-sm font-medium capitalize transition-colors ${
                network === net
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {net}
            </button>
          ))}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-[44px] touch-manipulation"
          onClick={() => void load(network)}
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] touch-manipulation"
          disabled={loading || !data || data.totalWallets === 0}
          asChild
        >
          <a href={`/api/admin/owl-center/gen2/minters?network=${network}&format=csv`} download>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </a>
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="status">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Unique minter wallets</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{data ? data.totalWallets : '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Total mints</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{data ? data.totalMints : '—'}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading minters…
        </div>
      ) : data && data.wallets.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top minters</CardTitle>
            <CardDescription>Showing the top {Math.min(50, data.wallets.length)} of {data.totalWallets}.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3">Wallet</th>
                  <th className="pb-2 tabular-nums">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {data.wallets.slice(0, 50).map((w) => (
                  <tr key={w.wallet} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3">
                      <a
                        href={`https://solscan.io/account/${encodeURIComponent(w.wallet)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] items-center break-all font-mono text-xs text-primary underline-offset-2 hover:underline"
                      >
                        {w.wallet.length > 12 ? `${w.wallet.slice(0, 6)}…${w.wallet.slice(-6)}` : w.wallet}
                      </a>
                    </td>
                    <td className="py-2 tabular-nums">{w.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : !error ? (
        <p className="text-sm text-muted-foreground">No minters recorded yet for {network}.</p>
      ) : null}
    </div>
  )
}
