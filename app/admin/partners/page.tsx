'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, CheckCircle2, HeartHandshake, Loader2, Radio } from 'lucide-react'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import type { PartnerCommunityCreatorRow } from '@/lib/db/partner-community-creators-admin'

type CreatorRow = PartnerCommunityCreatorRow & { profile_display_name: string | null }

export default function AdminPartnersOverviewPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [creators, setCreators] = useState<CreatorRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [apiSecret, setApiSecret] = useState<string | null>(null)

  const [form, setForm] = useState({
    creator_wallet: '',
    discord_guild_id: '',
    name: '',
    webhook_url: '',
  })

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoading(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  const fetchCreators = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch('/api/admin/partner-community-creators', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.creators)) {
        setCreators(data.creators)
      } else {
        setCreators([])
      }
    } catch {
      setCreators([])
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void fetchCreators()
  }, [isAdmin, fetchCreators])

  const unlinked = creators.filter((c) => c.is_active && !c.discord_partner_tenant_id?.trim())

  const onLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setApiSecret(null)
    const creatorWallet = form.creator_wallet.trim()
    const guildId = form.discord_guild_id.trim()
    if (!creatorWallet || !guildId) {
      setError('Pick a partner wallet and paste the Discord server ID.')
      return
    }
    setLinking(true)
    try {
      const res = await fetch(
        `/api/admin/partner-community-creators/${encodeURIComponent(creatorWallet)}/link-discord`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            discord_guild_id: guildId,
            name: form.name.trim() || undefined,
            webhook_url: form.webhook_url.trim() || undefined,
            status: 'active',
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not link Discord.')
        return
      }
      const tenantId = data.partner?.id ? String(data.partner.id) : ''
      setSuccess(
        data.createdTenant
          ? `Created Discord tenant${tenantId ? ` ${tenantId}` : ''} and linked to this partner.`
          : `Linked existing Discord tenant${tenantId ? ` ${tenantId}` : ''} to this partner.`
      )
      if (typeof data.apiSecret === 'string' && data.apiSecret) setApiSecret(data.apiSecret)
      await fetchCreators()
    } catch {
      setError('Network error while linking Discord.')
    } finally {
      setLinking(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto flex justify-center px-4 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!connected || !publicKey) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <p className="mb-4 text-muted-foreground">Connect a full-admin wallet to manage partners.</p>
        <WalletConnectButton />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <p className="text-muted-foreground">Access denied.</p>
        <Button asChild variant="link" className="mt-4">
          <Link href="/admin">Owl Vision</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-6 min-h-[44px] touch-manipulation">
        <Link href="/admin">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Owl Vision
        </Link>
      </Button>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <HeartHandshake className="h-4 w-4" />
              Allowlist
            </CardTitle>
            <CardDescription>
              {loadingList
                ? '…'
                : `${creators.filter((c) => c.is_active).length} active · ${unlinked.length} missing Discord`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-[44px] touch-manipulation">
              <Link href="/admin/partners/creators">Manage wallets</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4" />
              Discord servers
            </CardTitle>
            <CardDescription>Guild IDs, webhooks, API secrets, raffle channel pings.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-[44px] touch-manipulation">
              <Link href="/admin/partners/discord">Manage Discord</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8 border-primary/30">
        <CardHeader>
          <CardTitle className="text-lg">Link Discord in one step</CardTitle>
          <CardDescription>
            Partner already on the allowlist (e.g. Partner Pro one-time setup) and paid? Paste their{' '}
            <strong className="font-medium text-foreground">server ID</strong> — we create/reuse the Discord tenant and
            attach it. No monthly Discord USDC renewals. Webhook optional (add later for channel posts).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onLink} className="space-y-4">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {success ? (
              <p className="flex items-start gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{success}</span>
              </p>
            ) : null}
            {apiSecret ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3">
                <p className="mb-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                  API secret (copy once — not shown again)
                </p>
                <code className="block break-all text-xs">{apiSecret}</code>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="link-wallet">Partner wallet</Label>
              <select
                id="link-wallet"
                className="flex min-h-[44px] w-full touch-manipulation rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.creator_wallet}
                onChange={(e) => {
                  const w = e.target.value
                  const row = creators.find((c) => c.creator_wallet === w)
                  setForm((f) => ({
                    ...f,
                    creator_wallet: w,
                    name: f.name || row?.display_label || row?.profile_display_name || '',
                  }))
                }}
                required
              >
                <option value="">Select allowlisted wallet…</option>
                {creators.map((c) => (
                  <option key={c.creator_wallet} value={c.creator_wallet}>
                    {(c.display_label || c.profile_display_name || 'Partner').slice(0, 40)}
                    {c.discord_partner_tenant_id ? ' · Discord linked' : ' · not linked'} —{' '}
                    {c.creator_wallet.slice(0, 4)}…{c.creator_wallet.slice(-4)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-guild">Discord server ID</Label>
              <Input
                id="link-guild"
                className="min-h-[44px] font-mono text-sm touch-manipulation"
                placeholder="e.g. 1368549684393807974"
                value={form.discord_guild_id}
                onChange={(e) => setForm((f) => ({ ...f, discord_guild_id: e.target.value }))}
                required
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-name">Tenant display name (optional)</Label>
              <Input
                id="link-name"
                className="min-h-[44px] touch-manipulation"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Defaults to partner label"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-wh">Incoming webhook URL (optional)</Label>
              <Input
                id="link-wh"
                className="min-h-[44px] font-mono text-xs touch-manipulation"
                placeholder="https://discord.com/api/webhooks/…"
                value={form.webhook_url}
                onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))}
                autoComplete="off"
              />
            </div>

            <Button type="submit" disabled={linking} className="min-h-[44px] w-full touch-manipulation sm:w-auto">
              {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create / link Discord'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        After linking: partner connects Discord on the Owltopia dashboard (same wallet), invites the bot, then runs{' '}
        <code className="rounded bg-muted/60 px-1 text-xs">/owltopia-wl create</code> in their server.
      </p>
    </div>
  )
}
