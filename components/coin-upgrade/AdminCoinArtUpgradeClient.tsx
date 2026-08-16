'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CoinArtUpgradeAuthorizeClient } from '@/components/coin-upgrade/CoinArtUpgradeAuthorizeClient'

type Stats = {
  enabled: boolean
  fee_sol: number
  reward_multiplier: number
  total: number
  updated: number
  pending: number
  failed: number
  sol_collected: number
  catalog_size: number
}

/**
 * Admin overview for coin art upgrades + embeds the same one-button authorize
 * flow Gembird uses on /coin-upgrade/authorize.
 */
export function AdminCoinArtUpgradeClient() {
  const { connected } = useWallet()
  const { setVisible } = useWalletModal()
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/coin-upgrade/stats', { credentials: 'include', cache: 'no-store' })
      if (res.status === 401) {
        setError('Sign in with an admin wallet to see upgrade stats.')
        return
      }
      const json = (await res.json().catch(() => null)) as (Stats & { error?: string }) | null
      if (!res.ok || !json || json.error) {
        setError(json?.error || 'Could not load stats.')
        return
      }
      setStats(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load stats.')
    }
  }, [])

  useEffect(() => {
    if (connected) void loadStats()
  }, [connected, loadStats])

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-8 safe-area-bottom">
      <div className="space-y-2">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-theme-prime"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Admin
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-theme-prime" aria-hidden />
          Coin art upgrade
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Optional paid Owltopia Coin art upgrade. Send Gembird{' '}
          <Link href="/coin-upgrade/authorize" className="text-theme-prime underline-offset-4 hover:underline">
            /coin-upgrade/authorize
          </Link>{' '}
          — he connects the collection wallet in Phantom and taps Approve. No CLI.
        </p>
      </div>

      {!connected ? (
        <Button type="button" variant="outline" onClick={() => setVisible(true)}>
          Connect admin wallet
        </Button>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !stats ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading stats…
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-xl border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Enabled</p>
            <p className="font-medium">{stats.enabled ? 'Yes' : 'No (dark)'}</p>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Fee</p>
            <p className="font-medium">{stats.fee_sol} SOL</p>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Upgraded</p>
            <p className="font-medium">
              {stats.updated}
              {stats.pending || stats.failed
                ? ` (${stats.pending} pending / ${stats.failed} failed)`
                : ''}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">SOL collected</p>
            <p className="font-medium">{stats.sol_collected.toFixed(2)}</p>
          </div>
          <div className="rounded-xl border border-border/60 p-3 col-span-2">
            <p className="text-xs text-muted-foreground">Catalog size</p>
            <p className="font-medium">{stats.catalog_size} / 1000</p>
          </div>
          <div className="rounded-xl border border-border/60 p-3 col-span-2">
            <p className="text-xs text-muted-foreground">Nested reward multiplier</p>
            <p className="font-medium">{stats.reward_multiplier}×</p>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Authorize hot key (Gembird)</h2>
        <CoinArtUpgradeAuthorizeClient embedded />
      </section>
    </main>
  )
}
