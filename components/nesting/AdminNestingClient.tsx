'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type {
  StakingPoolRow,
  StakingAssetType,
  RewardRateUnit,
  NestingAdapterMode,
  LockEnforcementSource,
} from '@/lib/db/staking-pools'
import { getCachedAdmin, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'
import { StakingPoolCard } from '@/components/nesting/StakingPoolCard'
import { SectionHeader } from '@/components/council/SectionHeader'
import { PoolOnChainSettingsForm } from '@/components/nesting/PoolOnChainSettingsForm'
import { NESTING_RECONCILE_MAX_BATCH } from '@/lib/nesting/rpc-policy'

const emptyForm = () => ({
  name: '',
  slug: '',
  description: '',
  asset_type: 'token' as StakingAssetType,
  token_mint: '',
  collection_key: '',
  reward_token: '',
  reward_rate: '0',
  reward_rate_unit: 'daily' as RewardRateUnit,
  lock_period_days: '0',
  minimum_stake: '',
  maximum_stake: '',
  platform_fee_bps: '0',
  display_order: '0',
  is_active: true,
  partner_project_slug: '',
  adapter_mode: 'mock' as NestingAdapterMode,
  lock_enforcement_source: 'database' as LockEnforcementSource,
  is_onchain_enabled: false,
  requires_onchain_sync: false,
})

export function AdminNestingClient() {
  const { publicKey, connected, signMessage } = useWallet()
  const visibilityTick = useVisibilityTick()
  const wallet = publicKey?.toBase58() ?? ''

  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )
  const [loadingAdmin, setLoadingAdmin] = useState(true)
  const [sessionReady, setSessionReady] = useState<boolean | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)

  const [pools, setPools] = useState<StakingPoolRow[]>([])
  const [loadingPools, setLoadingPools] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState(emptyForm)
  const [savingPoolId, setSavingPoolId] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoadingAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setLoadingAdmin(false)
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role as AdminRole | undefined)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
      .finally(() => {
        if (!cancelled) setLoadingAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, visibilityTick])

  useEffect(() => {
    if (!connected || !publicKey || !isAdmin) {
      setSessionReady(null)
      return
    }
    let cancelled = false
    fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' })
      .then((res) => {
        if (!cancelled) setSessionReady(res.ok)
      })
      .catch(() => {
        if (!cancelled) setSessionReady(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, isAdmin, visibilityTick])

  const fetchPools = useCallback(async () => {
    setLoadingPools(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/staking/pools', { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Failed to load pools')
        return
      }
      setPools(Array.isArray(json.pools) ? json.pools : [])
    } finally {
      setLoadingPools(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin && sessionReady) void fetchPools()
  }, [isAdmin, sessionReady, fetchPools])

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(publicKey.toBase58())}`, {
        credentials: 'include',
      })
      if (!nonceRes.ok) {
        const data = await nonceRes.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to get nonce')
      }
      const { message } = await nonceRes.json()
      const messageBytes = new TextEncoder().encode(message)
      const signature = await signMessage(messageBytes)
      const signatureBase64 =
        typeof signature === 'string'
          ? btoa(signature)
          : btoa(String.fromCharCode(...new Uint8Array(signature)))
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          message,
          signature: signatureBase64,
        }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data?.error || 'Verification failed')
      }
      setSessionReady(true)
      await fetchPools()
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }, [publicKey, signMessage, fetchPools])

  const createPool = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/staking/pools', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          description: form.description,
          asset_type: form.asset_type,
          token_mint: form.token_mint || null,
          collection_key: form.collection_key || null,
          reward_token: form.reward_token || null,
          reward_rate: Number(form.reward_rate),
          reward_rate_unit: form.reward_rate_unit,
          lock_period_days: Number(form.lock_period_days),
          minimum_stake: form.minimum_stake === '' ? null : Number(form.minimum_stake),
          maximum_stake: form.maximum_stake === '' ? null : Number(form.maximum_stake),
          platform_fee_bps: Number(form.platform_fee_bps),
          display_order: Number(form.display_order),
          is_active: form.is_active,
          partner_project_slug: form.partner_project_slug || null,
          adapter_mode: form.adapter_mode,
          lock_enforcement_source: form.lock_enforcement_source,
          is_onchain_enabled: form.is_onchain_enabled,
          requires_onchain_sync: form.requires_onchain_sync,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Save failed')
        return
      }
      setForm(emptyForm())
      await fetchPools()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (pool: StakingPoolRow, next: boolean) => {
    setSaveError(null)
    const res = await fetch(`/api/admin/staking/pools/${pool.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSaveError(typeof json?.error === 'string' ? json.error : 'Update failed')
      return
    }
    await fetchPools()
  }

  const runReconcile = async () => {
    setReconciling(true)
    setReconcileMsg(null)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/staking/reconcile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: NESTING_RECONCILE_MAX_BATCH }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Reconcile failed')
        return
      }
      const n = typeof json?.processed === 'number' ? json.processed : 0
      setReconcileMsg(`Processed ${n} position(s). Max ${json?.max_batch ?? NESTING_RECONCILE_MAX_BATCH} per call — no polling.`)
      await fetchPools()
    } finally {
      setReconciling(false)
    }
  }

  if (!connected || !publicKey) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <p className="text-muted-foreground mb-4">Connect an admin wallet to manage nesting pools.</p>
      </div>
    )
  }

  if (loadingAdmin) {
    return (
      <div className="container mx-auto px-4 py-10 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Checking access…
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-xl">
        <p className="text-destructive">This wallet is not an admin.</p>
        <Button variant="outline" className="mt-4 min-h-[44px]" asChild>
          <Link href="/admin">Back to Owl Vision</Link>
        </Button>
      </div>
    )
  }

  if (!sessionReady) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-xl space-y-4">
        <Button variant="ghost" size="sm" asChild className="min-h-[44px]">
          <Link href="/admin" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Owl Vision
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Owl Nesting admin</h1>
        <p className="text-muted-foreground text-sm">Sign in to create and edit staking pools.</p>
        {signInError && <p className="text-destructive text-sm">{signInError}</p>}
        <Button onClick={() => void handleSignIn()} disabled={signingIn || !signMessage}>
          {signingIn ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Sign in with wallet
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 pb-16 max-w-5xl space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="min-h-[44px] mb-2">
            <Link href="/admin" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Owl Vision
            </Link>
          </Button>
          <h1 className="text-2xl sm:text-3xl font-display text-theme-prime tracking-wide">Owl Nesting admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pools live in Supabase (read model). Adapter mode and on-chain addresses prepare for real staking without
            wallet-wide RPC scans.
          </p>
        </div>
        <Button variant="outline" size="sm" className="min-h-[44px]" asChild>
          <Link href="/nesting">View public page</Link>
        </Button>
      </div>

      {saveError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      <section className="space-y-4">
        <SectionHeader title="Create pool" description="Slug must be unique. Reward rate uses the selected unit (snapshot at user stake time)." />
        <Card className="rounded-xl border-green-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-5 w-5" aria-hidden />
              New pool
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="np-name">Name</Label>
              <Input id="np-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-slug">Slug</Label>
              <Input id="np-slug" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} className="font-mono min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-order">Display order</Label>
              <Input id="np-order" inputMode="numeric" value={form.display_order} onChange={(e) => setForm((f) => ({ ...f, display_order: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="np-desc">Description</Label>
              <Input id="np-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-asset">Asset type</Label>
              <select
                id="np-asset"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
                value={form.asset_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, asset_type: e.target.value as StakingAssetType }))
                }
              >
                <option value="token">token</option>
                <option value="nft">nft</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-lock">Lock (days)</Label>
              <Input id="np-lock" inputMode="numeric" value={form.lock_period_days} onChange={(e) => setForm((f) => ({ ...f, lock_period_days: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-rate">Reward rate</Label>
              <Input id="np-rate" inputMode="decimal" value={form.reward_rate} onChange={(e) => setForm((f) => ({ ...f, reward_rate: e.target.value }))} className="font-mono min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-unit">Reward unit</Label>
              <select
                id="np-unit"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
                value={form.reward_rate_unit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, reward_rate_unit: e.target.value as RewardRateUnit }))
                }
              >
                <option value="hourly">hourly</option>
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-rt">Reward token label</Label>
              <Input id="np-rt" placeholder="e.g. OWL" value={form.reward_token} onChange={(e) => setForm((f) => ({ ...f, reward_token: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-mint">Token mint (optional)</Label>
              <Input id="np-mint" className="font-mono text-xs min-h-[44px]" value={form.token_mint} onChange={(e) => setForm((f) => ({ ...f, token_mint: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-coll">Collection key (optional)</Label>
              <Input id="np-coll" className="font-mono text-xs min-h-[44px]" value={form.collection_key} onChange={(e) => setForm((f) => ({ ...f, collection_key: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-min">Min stake</Label>
              <Input id="np-min" inputMode="decimal" value={form.minimum_stake} onChange={(e) => setForm((f) => ({ ...f, minimum_stake: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-max">Max stake</Label>
              <Input id="np-max" inputMode="decimal" value={form.maximum_stake} onChange={(e) => setForm((f) => ({ ...f, maximum_stake: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-fee">Platform fee (bps)</Label>
              <Input id="np-fee" inputMode="numeric" value={form.platform_fee_bps} onChange={(e) => setForm((f) => ({ ...f, platform_fee_bps: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-partner">Partner slug (optional)</Label>
              <Input id="np-partner" value={form.partner_project_slug} onChange={(e) => setForm((f) => ({ ...f, partner_project_slug: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-adapter">Default adapter mode</Label>
              <select
                id="np-adapter"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
                value={form.adapter_mode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, adapter_mode: e.target.value as NestingAdapterMode }))
                }
              >
                <option value="mock">mock</option>
                <option value="solana_ready">solana_ready</option>
                <option value="onchain_enabled">onchain_enabled</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-lock-src">Lock enforcement</Label>
              <select
                id="np-lock-src"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
                value={form.lock_enforcement_source}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    lock_enforcement_source: e.target.value as LockEnforcementSource,
                  }))
                }
              >
                <option value="database">database</option>
                <option value="onchain">onchain</option>
                <option value="hybrid">hybrid</option>
              </select>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="np-onchain-flag"
                ariaLabel="On-chain enabled flag for new pool"
                checked={form.is_onchain_enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_onchain_enabled: v }))}
              />
              <Label htmlFor="np-onchain-flag">On-chain enabled (metadata)</Label>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="np-req-sync"
                ariaLabel="Requires on-chain sync for new pool"
                checked={form.requires_onchain_sync}
                onCheckedChange={(v) => setForm((f) => ({ ...f, requires_onchain_sync: v }))}
              />
              <Label htmlFor="np-req-sync">Requires on-chain sync (users can POST /sync)</Label>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="np-active"
                ariaLabel="Pool active — shown on public nesting landing"
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <Label htmlFor="np-active">Active (shown on public landing)</Label>
            </div>
            <div className="sm:col-span-2">
              <Button
                type="button"
                className="min-h-[44px] bg-green-600 hover:bg-green-700"
                disabled={saving || !form.name.trim() || !form.slug.trim() || !form.description.trim()}
                onClick={() => void createPool()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create pool
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Sparse reconcile (RPC)"
          description={`Runs up to ${NESTING_RECONCILE_MAX_BATCH} pending/stale positions — one getTransaction each. Trigger manually; do not wire to aggressive polling.`}
        />
        <Card className="rounded-xl border-border/60">
          <CardContent className="pt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={reconciling}
              onClick={() => void runReconcile()}
            >
              {reconciling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reconcile pending positions
            </Button>
            {reconcileMsg ? <p className="text-sm text-muted-foreground">{reconcileMsg}</p> : null}
          </CardContent>
        </Card>
      </section>

      <section>
        <SectionHeader title="All pools" description="Toggle active, adapter mode, and on-chain metadata per pool." />
        {loadingPools ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : pools.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">No pools yet.</p>
        ) : (
          <ul className="grid gap-6">
            {pools.map((pool) => (
              <li key={pool.id} className="space-y-3">
                <StakingPoolCard pool={pool} compact />
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">Public listing</span>
                  <Switch
                    id={`pool-active-${pool.id}`}
                    ariaLabel={`Toggle active: ${pool.name}`}
                    checked={pool.is_active}
                    onCheckedChange={(v) => void toggleActive(pool, v)}
                  />
                  <Button variant="outline" size="sm" className="min-h-[44px]" asChild>
                    <Link href={`/dashboard/nesting?pool=${encodeURIComponent(pool.id)}`}>Test stake UI</Link>
                  </Button>
                </div>
                <PoolOnChainSettingsForm
                  pool={pool}
                  isSaving={savingPoolId === pool.id}
                  onBusyChange={(busy) => setSavingPoolId(busy ? pool.id : null)}
                  onSaveSuccess={fetchPools}
                  onRemoteError={(msg) => setSaveError(msg)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
