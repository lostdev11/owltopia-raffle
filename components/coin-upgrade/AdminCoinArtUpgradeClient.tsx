'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { ArrowLeft, CheckCircle2, Copy, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { CoinArtUpgradeAuthorizeClient } from '@/components/coin-upgrade/CoinArtUpgradeAuthorizeClient'
import { CoinArtUpgradeArtUploadPanel } from '@/components/coin-upgrade/CoinArtUpgradeArtUploadPanel'

type Stats = {
  enabled: boolean
  upgrades_enabled: boolean
  env?: { killSwitch: boolean; forceOn: boolean }
  fee_sol: number
  reward_multiplier: number
  total: number
  updated: number
  pending: number
  failed: number
  sol_collected: number
  catalog_size: number
}

type UpgradeSettings = {
  settings: {
    upgrades_enabled: boolean
    updated_at: string
    updated_by_wallet: string | null
  }
  enabled: boolean
  env: { killSwitch: boolean; forceOn: boolean }
}

type HotKeyStatus = {
  wallet_address: string | null
  source: 'env' | 'database' | 'none'
  env_override: boolean
  authorized: boolean
  authorize_url: string
  error?: string
}

/**
 * Admin overview for coin art upgrades: create the server hot key in-app,
 * then send Gembird the Phantom authorize link.
 */
export function AdminCoinArtUpgradeClient() {
  const { connected } = useWallet()
  const { setVisible } = useWalletModal()
  const [stats, setStats] = useState<Stats | null>(null)
  const [upgradeSettings, setUpgradeSettings] = useState<UpgradeSettings | null>(null)
  const [hotKey, setHotKey] = useState<HotKeyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const [statsRes, hotRes, settingsRes] = await Promise.all([
        fetch('/api/admin/coin-upgrade/stats', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/admin/coin-upgrade/hot-key', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/admin/coin-upgrade/settings', { credentials: 'include', cache: 'no-store' }),
      ])
      if (statsRes.status === 401 || hotRes.status === 401 || settingsRes.status === 401) {
        setError('Sign in with an admin wallet to manage coin art upgrades.')
        return
      }
      const statsJson = (await statsRes.json().catch(() => null)) as (Stats & { error?: string }) | null
      const hotJson = (await hotRes.json().catch(() => null)) as HotKeyStatus | null
      const settingsJson = (await settingsRes.json().catch(() => null)) as (UpgradeSettings & {
        error?: string
      }) | null
      if (!statsRes.ok || !statsJson || statsJson.error) {
        setError(statsJson?.error || 'Could not load stats.')
        return
      }
      if (!hotRes.ok || !hotJson) {
        setError(hotJson?.error || 'Could not load hot key status.')
        return
      }
      if (!settingsRes.ok || !settingsJson || settingsJson.error) {
        setError(settingsJson?.error || 'Could not load upgrade settings.')
        return
      }
      setStats(statsJson)
      setHotKey(hotJson)
      setUpgradeSettings(settingsJson)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load admin data.')
    }
  }, [])

  useEffect(() => {
    if (connected) void load()
  }, [connected, load])

  const createHotKey = useCallback(
    async (rotate: boolean) => {
      if (busy) return
      if (rotate) {
        const ok = window.confirm(
          'Replace the hot key? Gembird must approve again on /coin-upgrade/authorize, and you must fund the new address.'
        )
        if (!ok) return
      }
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch('/api/admin/coin-upgrade/hot-key', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rotate }),
        })
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean
          wallet_address?: string
          message?: string
          error?: string
        } | null
        if (!res.ok) {
          throw new Error(json?.error || 'Could not create hot key.')
        }
        setNotice(json?.message || 'Hot key created.')
        await load()
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'Could not create hot key.')
      } finally {
        setBusy(false)
      }
    },
    [busy, load]
  )

  const patchUpgradesEnabled = useCallback(
    async (next: boolean) => {
      if (toggleBusy) return
      if (next && (stats?.catalog_size ?? 0) < 1000) {
        const ok = window.confirm(
          `Catalog is only ${stats?.catalog_size ?? 0}/1000. Turn on upgrades anyway?`
        )
        if (!ok) return
      }
      setToggleBusy(true)
      setNotice(null)
      try {
        const res = await fetch('/api/admin/coin-upgrade/settings', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ upgrades_enabled: next }),
        })
        const json = (await res.json().catch(() => null)) as (UpgradeSettings & { error?: string }) | null
        if (!res.ok) {
          throw new Error(json?.error || 'Could not update upgrade toggle.')
        }
        setUpgradeSettings(json)
        setStats((prev) =>
          prev
            ? {
                ...prev,
                enabled: json?.enabled ?? prev.enabled,
                upgrades_enabled: json?.settings.upgrades_enabled ?? prev.upgrades_enabled,
                env: json?.env ?? prev.env,
              }
            : prev
        )
        setNotice(next ? 'Coin art upgrades are live on Nesting.' : 'Coin art upgrades are off (Coming soon).')
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'Could not update upgrade toggle.')
      } finally {
        setToggleBusy(false)
      }
    },
    [stats?.catalog_size, toggleBusy]
  )

  const copyAuthorizeLink = useCallback(async () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${origin}/coin-upgrade/authorize`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setNotice(`Copy this link for Gembird: ${url}`)
    }
  }, [])

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
          Create the server hot key here, fund it with a little SOL, then send Gembird the authorize
          link. When art is ready, upload the numbered ZIP below (same flow as Owl Center Phase B) —
          no local CLI required.
        </p>
      </div>

      {!connected ? (
        <Button type="button" variant="outline" onClick={() => setVisible(true)}>
          Connect admin wallet
        </Button>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !stats || !hotKey ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-border/60 bg-card/80 p-5 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Live on Nesting</h2>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Turn paid coin art upgrades on or off without redeploying. Env{' '}
                <span className="font-mono">COIN_ART_UPGRADE_ENABLED=false</span> still forces off;{' '}
                <span className="font-mono">=true</span> forces on.
              </p>
            </div>

            {upgradeSettings?.env.killSwitch ? (
              <p className="text-xs text-amber-500 rounded-lg border border-amber-500/40 px-3 py-2">
                <span className="font-medium">Env kill switch is on.</span> Remove or change{' '}
                <span className="font-mono">COIN_ART_UPGRADE_ENABLED=false</span> on Vercel to use this
                toggle.
              </p>
            ) : upgradeSettings?.env.forceOn ? (
              <p className="text-xs text-amber-500 rounded-lg border border-amber-500/40 px-3 py-2">
                <span className="font-medium">Env force-on is active.</span>{' '}
                <span className="font-mono">COIN_ART_UPGRADE_ENABLED=true</span> keeps upgrades live
                regardless of this toggle.
              </p>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {stats.enabled
                    ? 'On — holders can upgrade'
                    : upgradeSettings?.env.killSwitch
                      ? 'Off — blocked by env'
                      : 'Off — Coming soon on Nesting'}
                </p>
                {upgradeSettings?.settings.updated_at ? (
                  <p className="text-xs text-muted-foreground">
                    Last changed {new Date(upgradeSettings.settings.updated_at).toLocaleString()}
                    {upgradeSettings.settings.updated_by_wallet
                      ? ` · ${upgradeSettings.settings.updated_by_wallet.slice(0, 8)}…`
                      : ''}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-3 min-h-[44px]">
                {toggleBusy ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                ) : null}
                <Switch
                  id="coin-art-upgrade-enabled"
                  ariaLabel="Turn coin art upgrades on or off"
                  checked={upgradeSettings?.settings.upgrades_enabled === true}
                  disabled={
                    toggleBusy ||
                    upgradeSettings == null ||
                    upgradeSettings.env.killSwitch ||
                    upgradeSettings.env.forceOn
                  }
                  onCheckedChange={(v) => void patchUpgradesEnabled(v)}
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border/60 bg-card/80 p-5 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">1. Create hot key</h2>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Owltopia generates and stores the key on the server. The secret never shows in the
                browser.
              </p>
            </div>

            {hotKey.env_override ? (
              <p className="text-xs text-amber-500 rounded-lg border border-amber-500/40 px-3 py-2">
                A Vercel env hot key is active and overrides the Admin-created key. Remove{' '}
                <span className="font-mono">COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY</span> from Vercel
                to manage it here instead.
              </p>
            ) : null}

            {hotKey.wallet_address ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-border/60 px-3 py-2 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Hot wallet ({hotKey.source === 'env' ? 'from env' : 'from Admin'})
                  </p>
                  <p className="font-mono text-xs break-all">{hotKey.wallet_address}</p>
                </div>
                {hotKey.authorized ? (
                  <p className="text-xs text-emerald-500 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    Authorized on-chain — ready for art upgrades.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Fund this address with ~0.05 SOL (pays URI-update fees), then send Gembird the
                    authorize link.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px] touch-manipulation"
                    onClick={() => void copyAuthorizeLink()}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                    {copied ? 'Copied!' : 'Copy authorize link for Gembird'}
                  </Button>
                  {!hotKey.env_override ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-[44px] text-muted-foreground"
                      disabled={busy}
                      onClick={() => void createHotKey(true)}
                    >
                      Replace hot key…
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <Button
                type="button"
                className="min-h-[52px] touch-manipulation"
                disabled={busy || hotKey.env_override}
                onClick={() => void createHotKey(false)}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
                Create hot key
              </Button>
            )}

            {notice ? <p className="text-xs text-muted-foreground leading-relaxed">{notice}</p> : null}
          </section>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
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
            <div className="rounded-xl border border-border/60 p-3 col-span-2 sm:col-span-4">
              <p className="text-xs text-muted-foreground">Upgrade catalog</p>
              <p className="font-medium">{stats.catalog_size} / 1000 coins seeded</p>
            </div>
          </div>
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">2. Gembird authorize (or test yourself)</h2>
        <CoinArtUpgradeAuthorizeClient embedded />
      </section>

      {connected && !error ? <CoinArtUpgradeArtUploadPanel /> : null}
    </main>
  )
}
