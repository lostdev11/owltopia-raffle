'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { Loader2, ArrowLeft, Copy, CheckCircle2, Radio } from 'lucide-react'
import type { DiscordGiveawayPartnerTenant } from '@/lib/types'

type PartnerRow = Omit<DiscordGiveawayPartnerTenant, 'api_secret_hash'>

export default function AdminDiscordGiveawayPartnersPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [partners, setPartners] = useState<PartnerRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    webhook_url: '',
    discord_guild_id: '',
    status: 'trial' as 'trial' | 'active' | 'suspended',
    active_until: '',
    contact_note: '',
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
    fetch(`/api/admin/check?wallet=${addr}`)
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

  const fetchList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch('/api/admin/discord-giveaway-partners', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.partners)) {
        setPartners(data.partners)
      } else {
        setPartners([])
      }
    } catch {
      setPartners([])
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void fetchList()
  }, [isAdmin, fetchList])

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(key)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      // ignore
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setNewSecret(null)
    setCreating(true)
    try {
      const res = await fetch('/api/admin/discord-giveaway-partners', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          webhook_url: form.webhook_url.trim(),
          discord_guild_id: form.discord_guild_id.trim() || undefined,
          status: form.status,
          active_until: form.active_until.trim() || undefined,
          contact_note: form.contact_note.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(typeof data.error === 'string' ? data.error : 'Create failed')
        return
      }
      if (typeof data.apiSecret === 'string') setNewSecret(data.apiSecret)
      setForm({
        name: '',
        webhook_url: '',
        discord_guild_id: '',
        status: 'trial',
        active_until: '',
        contact_note: '',
      })
      await fetchList()
    } finally {
      setCreating(false)
    }
  }

  const handleRotate = async (id: string) => {
    setRotatingId(id)
    setNewSecret(null)
    try {
      const res = await fetch(`/api/admin/discord-giveaway-partners/${id}/rotate-secret`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && typeof data.apiSecret === 'string') setNewSecret(data.apiSecret)
      await fetchList()
    } finally {
      setRotatingId(null)
    }
  }

  if (!connected || !publicKey) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card className="max-w-lg mx-auto">
          <CardHeader>
            <CardTitle>Discord giveaway partners</CardTitle>
            <CardDescription>Connect an admin wallet.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="touch-manipulation min-h-[44px] [&_button]:min-h-[44px] [&_button]:w-full">
              <WalletConnectButton />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading || isAdmin === null) {
    return (
      <div className="container mx-auto py-8 px-4 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-muted-foreground">Access denied.</p>
        <Button asChild variant="link" className="mt-4">
          <Link href="/admin">Owl Vision</Link>
        </Button>
      </div>
    )
  }

  const notifyPath = '/api/integrations/discord-giveaway/notify'
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="touch-manipulation min-h-[44px] mb-6">
        <Link href="/admin">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Owl Vision
        </Link>
      </Button>

      <h1 className="text-2xl sm:text-3xl font-bold mb-2 flex items-center gap-2">
        <Radio className="h-7 w-7" />
        Discord giveaway partners
      </h1>
      <p className="text-muted-foreground text-sm mb-8">
        After a community pays (off-platform for now), create a tenant here: they add a channel **incoming webhook**,
        you set status and optional <span className="font-mono text-xs">active_until</span>. They receive automatic
        Discord posts when an NFT giveaway is linked to their tenant and deposit is verified / prize claimed. They can
        also call <span className="font-mono text-xs">{notifyPath}</span> with their API secret to push custom embeds
        (e.g. from their own bot).
      </p>

      {newSecret && (
        <Card className="mb-8 border-amber-500/40 bg-amber-500/[0.06]">
          <CardHeader>
            <CardTitle className="text-base">API secret (copy now — not shown again)</CardTitle>
            <CardDescription>Share only with the partner. Rotate if leaked.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <code className="text-xs break-all block bg-background/80 rounded p-3">{newSecret}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch-manipulation min-h-[44px]"
              onClick={() => copyText('secret', newSecret)}
            >
              {copiedField === 'secret' ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              Copy secret
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="mb-10">
        <CardHeader>
          <CardTitle className="text-lg">New partner</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div className="space-y-2">
              <Label htmlFor="p-name">Community name</Label>
              <Input
                id="p-name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-wh">Discord incoming webhook URL</Label>
              <Input
                id="p-wh"
                required
                value={form.webhook_url}
                onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))}
                className="min-h-[44px] font-mono text-xs"
                placeholder="https://discord.com/api/webhooks/…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-guild">Discord server ID (optional)</Label>
              <Input
                id="p-guild"
                value={form.discord_guild_id}
                onChange={(e) => setForm((f) => ({ ...f, discord_guild_id: e.target.value }))}
                className="min-h-[44px] font-mono text-sm"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="p-st">Status</Label>
                <select
                  id="p-st"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      status: e.target.value as 'trial' | 'active' | 'suspended',
                    }))
                  }
                >
                  <option value="trial">trial</option>
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-until">Active until (ISO, optional)</Label>
                <Input
                  id="p-until"
                  value={form.active_until}
                  onChange={(e) => setForm((f) => ({ ...f, active_until: e.target.value }))}
                  placeholder="2026-12-31T23:59:59.000Z"
                  className="min-h-[44px] font-mono text-xs"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-note">Contact / billing note (internal)</Label>
              <Input
                id="p-note"
                value={form.contact_note}
                onChange={(e) => setForm((f) => ({ ...f, contact_note: e.target.value }))}
                className="min-h-[44px]"
              />
            </div>
            <Button type="submit" disabled={creating} className="touch-manipulation min-h-[44px]">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create partner + API secret'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Partners</CardTitle>
          <CardDescription>
            Link a partner to a legacy one-off NFT giveaway on the{' '}
            <Link href="/admin/legacy-nft-giveaways" className="text-primary underline">
              legacy giveaways
            </Link>{' '}
            page (dropdown). Endpoint:{' '}
            <span className="font-mono text-xs break-all">{origin + notifyPath}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : partners.length === 0 ? (
            <p className="text-sm text-muted-foreground">No partners yet.</p>
          ) : (
            <ul className="space-y-4">
              {partners.map((p) => (
                <li key={p.id} className="border-b border-border/50 pb-4 last:border-0 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground font-mono break-all">{p.id}</p>
                      <p className="text-xs mt-1">
                        <span className="font-medium">{p.status}</span>
                        {p.active_until ? (
                          <span className="text-muted-foreground"> · until {p.active_until}</span>
                        ) : null}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="touch-manipulation min-h-[44px] shrink-0"
                      disabled={rotatingId === p.id}
                      onClick={() => handleRotate(p.id)}
                    >
                      {rotatingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Rotate API secret'}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    onClick={() => copyText(`id-${p.id}`, p.id)}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy tenant id (for giveaway link)
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
